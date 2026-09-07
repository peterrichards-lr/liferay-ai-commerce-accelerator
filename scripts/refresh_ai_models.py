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

Each provider is refreshed independently, from whatever key is in the environment. A
provider whose key is absent keeps the entries it already has rather than being
emptied, so a partial set of keys refreshes what it can and leaves the rest alone.

That is deliberate rather than merely tolerant. A key that cannot be shared with CI -
a personal key, say - can still refresh its provider from a developer's machine:

    set -a; . .env; set +a
    python3 scripts/refresh_ai_models.py --check

The scheduled workflow refreshes the providers whose keys are repository secrets, and
leaves the others exactly as they were. Neither run clobbers the other.

Last Updated: 2026-09-07 | Last Reviewed: 2026-09-07
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime
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

# How many models to offer per provider. Three gives an operator a cheap, a
# balanced and a capable choice without turning the dropdown into a catalogue.
MODELS_PER_PROVIDER = 3

# A model within this many days of its published shutdown is not offered. A
# model retired mid-demo is worse than one a version behind, and the dropdown
# is seeded into a running install that may not be redeployed for a while.
SHUTDOWN_MARGIN_DAYS = 30

# Kinds of model that cannot serve a generateJSON call, matched on the id.
#
# This was previously an allowlist of known-good families, which meant a new
# family stayed out of the dropdown until someone widened the list by hand -
# openai shipped 133 models and three were offered. Excluding by kind instead
# keeps new families flowing through, at the cost of needing a term added
# whenever a provider invents a new category. That cost is real: `transcribe`,
# `sora`, `lyria`, `codex`, `deep-research`, `computer-use`, `robotics` and
# `omni` were all absent from the original list.
#
# It is deliberately a cheap pre-filter and not the safety mechanism. Names
# cannot be trusted to describe capability, so what actually decides whether a
# model is offered is the probe in scripts/probe_ai_models.mjs, which makes a
# real call. This only avoids probing a hundred models to find three.
NON_TEXT_HINT = re.compile(
    r"embedding|moderation|whisper|tts|audio|realtime|speech|dall-e|imagen"
    r"|image|vision|rerank|transcribe|sora|lyria|veo|nano-banana|codex"
    r"|deep-research|computer-use|robotics|omni|antigravity|search"
    r"|instruct|babbage|davinci|gemma|guard|^chat-latest$",
    re.IGNORECASE,
)

# A dated snapshot: gpt-5.2-2025-12-11, claude-opus-4-1-20250805.
DATED_SNAPSHOT = re.compile(r"^(?P<base>.+)-\d{8}$|^(?P<base2>.+)-\d{4}-\d{2}-\d{2}$")

# A family is everything up to and including the version, so any trailing
# qualifier is treated as a variant of the same release.
#
# Naming a fixed set of qualifiers does not work: openai currently ships
# gpt-5.6-luna, gpt-5.6-sol and gpt-5.6-terra, and a list of known tiers
# (-mini, -pro, -nano) counted those as three separate families - so "the three
# latest" was two variants of gpt-5.6 plus gpt-6, and gpt-5.5 never got a look.
# Anything after the version is dropped instead, whatever it is called.
#
# This is a no-op where the version comes last, which is exactly right for
# anthropic: claude-opus-5 and claude-sonnet-5 are genuinely different choices
# rather than variants, and both survive.
#
#   gpt-6-astra        -> gpt-6
#   gpt-5.6-luna       -> gpt-5.6
#   gpt-4o-mini        -> gpt-4o
#   gemini-3.8-flash   -> gemini-3.8
#   claude-opus-5      -> claude-opus-5
FAMILY_BASE = re.compile(
    r"^(?P<base>.*?\d+[a-z]?(?:[.-]\d+[a-z]?)*)(?:-[a-z]+)*$", re.IGNORECASE
)

# Gemini's model list carries no creation date - only name, displayName, token
# limits and supported methods - so recency has to come from the version in the
# id. Extracts (3, 8) from gemini-3.8-flash and (2, 5) from gemini-2.5-pro.
VERSION_IN_ID = re.compile(r"(\d+)(?:[.-](\d+))?")


def _parse_iso(value) -> int:
    """Seconds since the epoch for an ISO 8601 timestamp, or None."""
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        return int(datetime.fromisoformat(text).timestamp())
    except ValueError:
        return None


def _redact(text) -> str:
    """Strip query strings from a message before it is printed.

    Gemini takes its key as a URL parameter, so an exception carrying the
    request URL carries the key with it - and this script prints exceptions.
    Everything after a `?` is dropped rather than the key being matched, so a
    provider that adds a differently-named credential parameter is covered
    without this needing to know about it.
    """
    return re.sub(r"\?[^\s]*", "?[redacted]", str(text))


def _get_json(url: str, headers: dict) -> dict:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_openai(api_key: str) -> list:
    payload = _get_json(
        "https://api.openai.com/v1/models",
        {"Authorization": f"Bearer {api_key}"},
    )
    # `created` is a unix timestamp and the only ordering the endpoint offers.
    # `shutdown_date` is a plain date and is the reason this is not simply a
    # recency sort: 52 of 127 models carried one when this was written, the
    # earliest already six weeks in the past. See #634.
    return [
        {
            "id": item.get("id"),
            "label": None,
            "created": item.get("created"),
            "shutdown": item.get("shutdown_date"),
        }
        for item in payload.get("data", [])
        if item.get("id")
    ]


def fetch_anthropic(api_key: str) -> list:
    payload = _get_json(
        "https://api.anthropic.com/v1/models?limit=1000",
        {"x-api-key": api_key, "anthropic-version": "2023-06-01"},
    )
    return [
        {
            "id": item.get("id"),
            "label": item.get("display_name"),
            # ISO 8601; parsed rather than compared as a string so a change of
            # precision or offset cannot reorder the list.
            "created": _parse_iso(item.get("created_at")),
        }
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
        # No date is reported, so recency is left to the version in the id.
        models.append({"id": name, "label": item.get("displayName"), "created": None})
    return models


PROVIDERS = {
    "openai": {"env": "OPENAI_API_KEY", "fetch": fetch_openai},
    "anthropic": {"env": "ANTHROPIC_API_KEY", "fetch": fetch_anthropic},
    "gemini": {"env": "GEMINI_API_KEY", "fetch": fetch_gemini},
}


def derive_label(model_id: str) -> str:
    """A readable label for a provider that does not supply one.

    Only OpenAI omits labels; Anthropic and Gemini report a display name. There
    used to be a hand-written map of the three OpenAI ids that were pinned, but
    the list is no longer pinned - it follows whatever the provider ships - so a
    map would be permanently one release behind. The result is a reasonable
    placeholder, not a promise; the pull request is reviewed by a human.
    """
    parts = model_id.split("-")
    head = parts[0].upper() if parts[0] in ("gpt", "o") else parts[0].title()

    # Keep a version token attached to the family name: gpt-5-mini reads better
    # as "GPT-5 Mini" than "GPT 5 Mini".
    rest = parts[1:]
    if rest and rest[0][:1].isdigit():
        head = f"{head}-{rest.pop(0)}"

    return " ".join([head, *(part.title() for part in rest)]).strip()


def family_of(model_id: str) -> str:
    """The release a model belongs to, ignoring tier and qualifier.

    gpt-5.4, gpt-5.4-mini and gpt-5.4-pro are one family; gemini-3.8-flash and
    gemini-3.8-flash-lite are another. Grouping by this is what stops "the three
    latest" collapsing into three tiers of a single release.
    """
    base = DATED_SNAPSHOT.match(model_id)
    if base:
        model_id = base.group("base") or base.group("base2")

    match = FAMILY_BASE.match(model_id)
    return match.group("base") if match else model_id


def version_key(model_id: str) -> tuple:
    """Ordering for providers that report no date, from the version in the id."""
    match = VERSION_IN_ID.search(model_id)
    if not match:
        return (0, 0)
    major = int(match.group(1))
    minor = int(match.group(2) or 0)
    return (major, minor)


def recency_key(model: dict) -> tuple:
    """Newest first. Falls back to the version when a provider reports no date.

    The date is preferred where it exists because a provider can publish a
    higher version number for an older model - a long-lived preview, say - and
    the timestamp is the provider's own answer rather than our inference.
    """
    created = model.get("created")
    return (
        1 if created else 0,
        created or 0,
        version_key(model["id"]),
        model["id"],
    )


def retiring_soon(model: dict, today: int) -> bool:
    """True when a model is past its shutdown date, or close enough to it.

    Only OpenAI publishes this; the others report nothing and are never
    excluded on these grounds.
    """
    shutdown = _parse_iso(model.get("shutdown"))
    if not shutdown:
        return False
    return shutdown - today < SHUTDOWN_MARGIN_DAYS * 86400


def curate(provider: str, models: list, today: int = None) -> list:
    """The newest MODELS_PER_PROVIDER families a provider offers.

    Undated aliases are preferred over dated snapshots so the list does not
    churn every time a provider publishes a new snapshot of the same model.
    """
    if today is None:
        today = int(datetime.now().timestamp())

    ids = {model["id"] for model in models}

    candidates = []
    for model in models:
        model_id = model["id"]

        if NON_TEXT_HINT.search(model_id):
            continue

        if retiring_soon(model, today):
            continue

        dated = DATED_SNAPSHOT.match(model_id)
        if dated and (dated.group("base") or dated.group("base2")) in ids:
            continue

        candidates.append(model)

    candidates.sort(key=recency_key, reverse=True)

    kept = []
    seen_families = set()
    for model in candidates:
        family = family_of(model["id"])
        if family in seen_families:
            continue
        seen_families.add(family)

        kept.append(
            {
                "label": model["label"] or derive_label(model["id"]),
                "value": model["id"],
                "provider": provider,
            }
        )

        if len(kept) == MODELS_PER_PROVIDER:
            break

    return kept


def rejected_candidates(provider: str, models: list) -> list:
    """What the kind filter excluded, so an over-broad term stays visible.

    The filter is a cost optimisation rather than a correctness mechanism, and
    a term that accidentally excludes a usable family would otherwise be
    invisible - the dropdown would simply be missing something with no trace.
    """
    return sorted(
        model["id"]
        for model in models
        if NON_TEXT_HINT.search(model["id"])
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
            print(
                f"  {provider}: fetch failed ({_redact(error)}) - keeping existing entries",
                file=sys.stderr,
            )
            skipped.append(provider)
            continue

        curated = curate(provider, fetched)
        excluded = rejected_candidates(provider, fetched)
        if excluded:
            unmatched[provider] = excluded
        if not curated:
            print(
                f"  {provider}: returned {len(fetched)} models, none survived the kind"
                " filter - keeping existing entries",
                file=sys.stderr,
            )
            skipped.append(provider)
            continue

        print(
            f"  {provider}: {len(fetched)} models offered, {len(curated)} kept"
            f" ({', '.join(entry['value'] for entry in curated)})"
        )
        collected.extend(curated)

    # A provider we could not reach keeps whatever it already had, so an expired
    # key never silently deletes that provider's models.
    for entry in previous:
        if entry.get("provider") in skipped:
            collected.append(entry)

    if not collected:
        print("No provider could be refreshed; leaving the list untouched.", file=sys.stderr)
        return 1

    # Grouped by provider, and within a provider left in the order curate()
    # produced - newest first - so the dropdown's first entry per provider is
    # the current one. defaultModelForProvider takes a provider's first option,
    # so this ordering decides what an operator gets by default.
    order = {"openai": 0, "anthropic": 1, "gemini": 2}
    collected.sort(key=lambda entry: order.get(entry["provider"], 99))

    print()
    print(summarise(previous, collected))

    if unmatched:
        print()
        print(
            "Excluded by the kind filter. A usable family wrongly listed here is"
        )
        print(
            "invisible in the dropdown, so it is worth a glance when this list changes:"
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
