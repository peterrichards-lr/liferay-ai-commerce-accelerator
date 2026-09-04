#!/usr/bin/env python3
"""Refresh the shipped AI model list from each provider's live catalogue.

The list is a runtime concern - it is seeded into the AICAConfiguration object and
editable afterwards - but the *shipped* list still goes stale. AiConfigPanel carried
claude-3-5-sonnet-20240620 and Gemini 1.5 long after both were superseded, and Gemini
had no entry at all despite being a selectable provider.

This writes the generation source and both catalogue mirrors. It never commits: the
workflow that runs it opens a pull request, because "no code changes between models"
holds within a model family and not across one (Opus 5 rejects `temperature`;
`budget_tokens` became `thinking: {type: "adaptive"}`). A new family needs a human to
confirm the existing call shape still works.

Last Updated: 2026-09-04 | Last Reviewed: 2026-09-04
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SOURCE_JSON = (
    ROOT
    / "client-extensions/ai-commerce-accelerator-frontend/src/config/ai-models.json"
)
MICROSERVICE_CATALOG = (
    ROOT / "client-extensions/ai-commerce-accelerator-microservice/utils/modelCatalog.cjs"
)
CONFIGURATION_CATALOG = (
    ROOT / "client-extensions/ai-commerce-accelerator-configuration/src/config/modelCatalog.js"
)

TIMEOUT_SECONDS = 30

# Families worth offering for structured commerce data generation. Every provider
# endpoint also returns embeddings, moderation, speech and image models, none of
# which can serve a generateJSON call - without an allowlist the dropdown fills
# with entries that fail the moment they are selected.
ALLOWED_FAMILIES = {
    "openai": (r"^gpt-4o$", r"^gpt-4o-mini$", r"^gpt-4\.1-mini$"),
    "anthropic": (r"^claude-(opus|sonnet|haiku)-\d+(-\d+)?$",),
    "gemini": (r"^gemini-\d+(\.\d+)?-(pro|flash)$",),
}

# OpenAI returns a bare id with no display name, unlike Anthropic (display_name)
# and Gemini (displayName). Anything unmatched falls back to a derived label.
OPENAI_LABELS = {
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4.1-mini": "GPT-4.1 Mini",
}

DATED_SNAPSHOT = re.compile(r"^(?P<base>.+)-\d{8}$")

# Models that plainly cannot serve a generateJSON call. Used only to keep the
# "not matched by the allowlist" report readable - never to include anything.
NON_TEXT_HINT = re.compile(
    r"embedding|moderation|whisper|tts|audio|realtime|speech|dall-e|imagen|image|vision|rerank",
    re.IGNORECASE,
)


def _get_json(url: str, headers: dict) -> dict:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_openai(api_key: str) -> list:
    payload = _get_json(
        "https://api.openai.com/v1/models",
        {"Authorization": f"Bearer {api_key}"},
    )
    return [
        {"id": item.get("id"), "label": None}
        for item in payload.get("data", [])
        if item.get("id")
    ]


def fetch_anthropic(api_key: str) -> list:
    payload = _get_json(
        "https://api.anthropic.com/v1/models?limit=1000",
        {"x-api-key": api_key, "anthropic-version": "2023-06-01"},
    )
    return [
        {"id": item.get("id"), "label": item.get("display_name")}
        for item in payload.get("data", [])
        if item.get("id")
    ]


def fetch_gemini(api_key: str) -> list:
    payload = _get_json(
        f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}&pageSize=1000",
        {},
    )
    models = []
    for item in payload.get("models", []):
        name = (item.get("name") or "").removeprefix("models/")
        if not name:
            continue
        # Only models that can actually answer a prompt.
        methods = item.get("supportedGenerationMethods") or []
        if methods and "generateContent" not in methods:
            continue
        models.append({"id": name, "label": item.get("displayName")})
    return models


PROVIDERS = {
    "openai": {"env": "OPENAI_API_KEY", "fetch": fetch_openai},
    "anthropic": {"env": "ANTHROPIC_API_KEY", "fetch": fetch_anthropic},
    "gemini": {"env": "GEMINI_API_KEY", "fetch": fetch_gemini},
}


def derive_label(model_id: str) -> str:
    """A readable label for a provider that does not supply one.

    Only reached for a model not in OPENAI_LABELS, which in practice means a
    newly released one. The result is a reasonable placeholder, not a promise -
    the pull request is reviewed by a human either way.
    """
    if model_id in OPENAI_LABELS:
        return OPENAI_LABELS[model_id]

    parts = model_id.split("-")
    head = parts[0].upper() if parts[0] in ("gpt", "o") else parts[0].title()

    # Keep a version token attached to the family name: gpt-5-mini reads better
    # as "GPT-5 Mini" than "GPT 5 Mini".
    rest = parts[1:]
    if rest and rest[0][:1].isdigit():
        head = f"{head}-{rest.pop(0)}"

    return " ".join([head, *(part.title() for part in rest)]).strip()


def curate(provider: str, models: list) -> list:
    """Allowlisted families only, undated aliases preferred, stable order."""
    patterns = ALLOWED_FAMILIES[provider]
    ids = {model["id"] for model in models}

    kept = []
    for model in models:
        model_id = model["id"]
        if not any(re.match(pattern, model_id) for pattern in patterns):
            continue

        # Drop a dated snapshot when the undated alias is also offered, so the
        # list does not churn every time a provider publishes a new snapshot.
        dated = DATED_SNAPSHOT.match(model_id)
        if dated and dated.group("base") in ids:
            continue

        kept.append(
            {
                "label": model["label"] or derive_label(model_id),
                "value": model_id,
                "provider": provider,
            }
        )

    kept.sort(key=lambda entry: entry["value"])
    return kept


def unmatched_candidates(provider: str, models: list) -> list:
    """Text-capable models the allowlist rejected.

    A provider releasing a new family is the case this whole job exists to catch,
    and it is also the case the allowlist cannot anticipate. Reporting these keeps
    the omission visible instead of silently narrowing the list.
    """
    patterns = ALLOWED_FAMILIES[provider]
    return sorted(
        model["id"]
        for model in models
        if not any(re.match(pattern, model["id"]) for pattern in patterns)
        and not NON_TEXT_HINT.search(model["id"])
        and not DATED_SNAPSHOT.match(model["id"])
    )


def render_js_array(entries: list, indent: str) -> str:
    lines = []
    for entry in entries:
        lines.append(
            f"{indent}{{ label: '{entry['label']}', value: '{entry['value']}', "
            f"provider: '{entry['provider']}' }},"
        )
    return "\n".join(lines)


def replace_catalog_block(path: Path, entries: list) -> bool:
    """Rewrite the DEFAULT_MODEL_OPTIONS array, leaving the rest of the file alone."""
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"(const DEFAULT_MODEL_OPTIONS = \[\n)(.*?)(\n\];)", re.DOTALL
    )
    match = pattern.search(text)
    if not match:
        raise SystemExit(f"Could not find DEFAULT_MODEL_OPTIONS in {path}")

    updated = text[: match.start(2)] + render_js_array(entries, "  ") + text[match.end(2) :]
    if updated == text:
        return False

    path.write_text(updated, encoding="utf-8")
    return True


def summarise(previous: list, current: list) -> str:
    before = {entry["value"] for entry in previous}
    after = {entry["value"] for entry in current}

    added = sorted(after - before)
    removed = sorted(before - after)

    lines = []
    if added:
        lines.append("Added: " + ", ".join(added))
    if removed:
        lines.append(
            "Removed: "
            + ", ".join(removed)
            + " (already selected in running installs - confirm before merging)"
        )
    if not lines:
        lines.append("No change.")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="report what would change without writing anything",
    )
    args = parser.parse_args()

    previous = json.loads(SOURCE_JSON.read_text(encoding="utf-8"))

    collected = []
    skipped = []
    unmatched = {}
    for provider, spec in PROVIDERS.items():
        api_key = os.environ.get(spec["env"], "").strip()
        if not api_key:
            # Refresh the providers we can rather than failing the whole run, so a
            # partially configured repository still benefits.
            skipped.append(provider)
            continue

        try:
            fetched = spec["fetch"](api_key)
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as error:
            print(f"  {provider}: fetch failed ({error}) - keeping existing entries", file=sys.stderr)
            skipped.append(provider)
            continue

        curated = curate(provider, fetched)
        overlooked = unmatched_candidates(provider, fetched)
        if overlooked:
            unmatched[provider] = overlooked
        if not curated:
            print(
                f"  {provider}: returned {len(fetched)} models, none matched the allowlist"
                " - keeping existing entries",
                file=sys.stderr,
            )
            skipped.append(provider)
            continue

        print(f"  {provider}: {len(fetched)} models offered, {len(curated)} kept")
        collected.extend(curated)

    # A provider we could not reach keeps whatever it already had, so an expired
    # key never silently deletes that provider's models.
    for entry in previous:
        if entry.get("provider") in skipped:
            collected.append(entry)

    if not collected:
        print("No provider could be refreshed; leaving the list untouched.", file=sys.stderr)
        return 1

    order = {"openai": 0, "anthropic": 1, "gemini": 2}
    collected.sort(key=lambda entry: (order.get(entry["provider"], 99), entry["value"]))

    print()
    print(summarise(previous, collected))

    if unmatched:
        print()
        print(
            "Text-capable models the allowlist did not match. A new family here needs a"
        )
        print(
            "human to confirm the existing call shape still works before it is offered:"
        )
        for provider, ids in sorted(unmatched.items()):
            print(f"  {provider}: {', '.join(ids)}")

    if args.check:
        return 0

    changed = collected != previous
    if changed:
        SOURCE_JSON.write_text(
            json.dumps(collected, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    replace_catalog_block(MICROSERVICE_CATALOG, collected)
    replace_catalog_block(CONFIGURATION_CATALOG, collected)

    if skipped:
        print(f"\nProviders not refreshed: {', '.join(sorted(skipped))}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
