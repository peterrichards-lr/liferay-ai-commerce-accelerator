#!/usr/bin/env bash
#
# The assertions about AICA's BUILT site that the shared check does not make.
#
# scripts/check_docs_rendered.py, copied verbatim from ai-agent-template, is the
# family check: leaked alert markers, unrendered diagrams, the per-page About
# link, alert titles, the nav, the home-page layout, the community notice, and
# the PRESENCE of the verification and social tags. It runs first in the docs
# workflow. Everything it covers was deleted from this file in #1335; what is
# left is the two things only this repository asks for.
#
# Both are silent in the source. `mkdocs build --strict` reports neither, and
# nor does the shared check:
#
#   - the verification tag can be PRESENT on every page and carry the WRONG
#     value. A template that hardcodes a token, interpolates a renamed key, or
#     loses its {% if %} guard renders a tag every presence check accepts and
#     Google reads as someone else's property. See #1312 and #1316.
#   - theme.logo, theme.favicon, extra.favicon_svg and the apple-touch icon are
#     config claims. A typo in any path still builds green and still deploys;
#     the reader silently gets Material's defaults back. See #1321.
#
# What this cannot do is tell you the configured token is the RIGHT one. A
# token that is well formed but issued for another property renders identically
# to a correct one. Only Google can settle that, and it does: the property
# reads as unverified in Search Console. The checks here cover the failures
# that are SILENT.
# repositories stay comparable. See #1312.
set -euo pipefail

# Exit early if executed inside the Docker container (as Liferay entrypoint runs all scripts in /mnt/liferay/scripts)
#
# Not hypothetical. This file has no business in a Liferay container, but the
# E2E mounts this whole directory as the entrypoint's script directory, so
# Liferay ran it with /mnt/liferay/scripts as $SITE, found no HTML, and exited
# 1 - correctly, by the rule below. The container died with it, and every
# bring-up from 2026-10-16 failed in ~130s with an empty Liferay log. See #1360.
#
# Same guard as run-e2e-ldm.sh, node_power.sh and sync-github-issues.sh, with
# one necessary difference: this file runs under `set -u`, so the bare
# `$LIFERAY_HOME` those three use would abort with "unbound variable" before
# the test could be evaluated. `${LIFERAY_HOME:-}` is required here.
# scripts/test_container_safe_scripts.py keeps the next one honest and accepts
# either spelling.
if [ -f /.dockerenv ] || [ -n "${LIFERAY_HOME:-}" ]; then
    echo "ℹ  Exiting early: check-docs-rendered.sh checks a built docs site, not meant to be run inside the Liferay container."
    if [ "${BASH_SOURCE[0]}" != "$0" ]; then
        return 0 2>/dev/null || exit 0
    else
        exit 0
    fi
fi

SITE="${1:-site}"
CONFIG="${2:-mkdocs.yml}"

if [ ! -d "$SITE" ]; then
    echo "No built site at '$SITE'. Run 'mkdocs build' first." >&2
    exit 1
fi

pages=$(find "$SITE" -name '*.html' | wc -l | tr -d ' ')
if [ "$pages" -eq 0 ]; then
    # An empty site directory would otherwise satisfy every check below by
    # having nothing to fail - the vacuous pass this file exists to avoid.
    echo "No HTML pages found under '$SITE'. Nothing was checked." >&2
    exit 1
fi

if [ ! -f "$CONFIG" ]; then
    echo "No MkDocs config at '$CONFIG'. Nothing to compare the output against." >&2
    exit 1
fi

# Read the token from the config rather than pinning a second copy here.
#
# mkdocs.yml carries a `!!python/name:` tag for the mermaid fence, so
# yaml.safe_load() refuses the file outright - hence sed. The pattern anchors
# the key to the start of the line, so a commented-out key does not match.
configured=$(sed -n 's/^[[:space:]]*google_site_verification:[[:space:]]*//p' "$CONFIG" \
    | head -1 | tr -d '"'\''' | tr -d ' \r')

fail=0

if [ -z "$configured" ]; then
    echo "[NO-TOKEN-CONFIGURED] extra.google_site_verification is not set in ${CONFIG}."
    echo "  The site would publish with no ownership token and Search Console would"
    echo "  drop the property at its next re-check."
    fail=1
elif ! echo "$configured" | grep -qE '^[A-Za-z0-9_-]{40,50}$'; then
    # Google issues a 43-character base64url token. This will not catch a wrong
    # token, but it does catch the ways a right one gets damaged: truncated on
    # a copy-paste, wrapped in stray punctuation, or replaced with a
    # placeholder like TODO or changeme.
    echo "[MALFORMED-TOKEN] extra.google_site_verification does not look like a Google token."
    echo "  Expected 40-50 characters of [A-Za-z0-9_-]; got ${#configured} character(s):"
    echo "    ${configured}"
    fail=1
fi

# 1. Value. Presence alone passes for a tag rendering the wrong thing: a
#    template that hardcodes a token, or interpolates a key that was renamed,
#    or emits content="" because someone removed the {% if %} guard. All three
#    look like a verified page to every check that only reads the source.
#
#    Only pages that HAVE the tag are compared: a page missing it entirely is
#    MISSING-VERIFICATION in the shared check, and is not repeated here.
if [ -n "$configured" ]; then
    mismatched=""
    while IFS= read -r -d '' page; do
        grep -q 'name="google-site-verification"' "$page" || continue
        # The tag spans several lines once Prettier has formatted the template,
        # so the content attribute is not on the line the name is on.
        rendered=$(grep -A2 'name="google-site-verification"' "$page" \
            | sed -n 's/.*content="\([^"]*\)".*/\1/p' | head -1)
        if [ "$rendered" != "$configured" ]; then
            mismatched="${mismatched}${page}|${rendered}"$'\n'
        fi
    done < <(find "$SITE" -name '*.html' -print0)

    if [ -n "$mismatched" ]; then
        count=$(echo "$mismatched" | grep -c '|' || true)
        echo "[WRONG-TOKEN-RENDERED] ${count} page(s) publish a token that is not the configured one."
        echo "  ${CONFIG} says: ${configured}"
        echo "  Pages affected, with what each published:"
        echo "$mismatched" | grep '|' | while IFS='|' read -r p r; do
            echo "    ${p#"$SITE"/} -> ${r:-(empty)}"
        done
        fail=1
    fi
fi


base_path=$(sed -n 's|^[[:space:]]*site_url:[[:space:]]*||p' "$CONFIG" | head -1 \
    | sed -e 's|^https\{0,1\}://[^/]*||' -e 's|/*$|/|')

# 2. Branding assets, on every page and resolvable.
#
#    theme.logo, theme.favicon, extra.favicon_svg and the apple-touch-icon are
#    config claims. A typo in any path, or a dropped `custom_dir`, still builds
#    green and still deploys - the reader just silently gets Material's
#    defaults back. Resolved the same way as the About link above: the href is
#    resolved against the page and the file must exist, so a path pointing
#    nowhere fails here rather than in a browser tab nobody is watching.
if ! python3 - "$SITE" "$base_path" <<'PYBRAND'; then
import os, re, sys

site, base_path = sys.argv[1], sys.argv[2]
head_re = re.compile(r"<head>.*?</head>", re.S | re.I)
link_re = re.compile(r'<link\b[^>]*?rel="([^"]+)"[^>]*?href="([^"]*)"[^>]*?>', re.I | re.S)
WANTED = {
    "stylesheet": "the shared stylesheet",
    "icon": "a favicon",
    "apple-touch-icon": "the apple-touch icon",
}

def resolve(root, href):
    href = href.split("#")[0].split("?")[0]
    if href.startswith("/"):
        rel = href[len(base_path):] if href.startswith(base_path) else href.lstrip("/")
        return os.path.normpath(os.path.join(site, rel))
    return os.path.normpath(os.path.join(root, href))

broken, missing_rel = [], []
for root, _, files in os.walk(site):
    for name in files:
        if not name.endswith(".html"):
            continue
        path = os.path.join(root, name)
        with open(path, encoding="utf-8", errors="replace") as fh:
            head = head_re.search(fh.read())
        if head is None:
            continue
        rels = set()
        for rel, href in link_re.findall(head.group(0)):
            rel = rel.strip().lower()
            if rel not in WANTED:
                continue
            rels.add(rel)
            if href.startswith(("http://", "https://", "//", "data:")):
                continue
            if not os.path.exists(resolve(root, href)):
                broken.append((os.path.relpath(path, site), rel, href))
        for rel in WANTED:
            if rel not in rels:
                missing_rel.append((os.path.relpath(path, site), rel))

if missing_rel:
    by_rel = {}
    for page, rel in missing_rel:
        by_rel.setdefault(rel, []).append(page)
    for rel, pages in sorted(by_rel.items()):
        print(f"[NO-{rel.upper()}] {len(pages)} page(s) do not reference {WANTED[rel]}.")
        for page in pages[:5]:
            print(f"    {page}")
if broken:
    print(f"[BROKEN-ASSET] {len(broken)} reference(s) point at a file that was not published.")
    for page, rel, href in broken[:10]:
        print(f'    {page}: rel="{rel}" href="{href}"')
if missing_rel or broken:
    sys.exit(1)
PYBRAND
    fail=1
fi

if [ "$fail" -ne 0 ]; then
    echo
    echo "The published output does not match what the source asks for."
    exit 1
fi

echo "${pages} page(s) checked: every one publishes the configured token (${configured})."
