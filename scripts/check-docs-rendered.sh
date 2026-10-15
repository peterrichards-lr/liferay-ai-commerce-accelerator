#!/usr/bin/env bash
#
# Asserts things about the BUILT site, not about its source.
#
# Every other documentation guard here reads the tree: check-docs-links.cjs
# walks markdown, check_docs_review.py reads footers, and `mkdocs build
# --strict` reports only that the build did not warn. None of them looks at
# what was actually published, and some defects exist only in the output.
#
# The ownership token is the first of those. overrides/main.html renders it
# only when `extra.google_site_verification` is set, so deleting the key keeps
# the build green - and Google, which re-checks ownership periodically, would
# quietly unverify the property. Nothing in the source would look wrong.
#
# What this cannot do is tell you the configured token is the RIGHT one. A
# token that is well formed but issued for another property, or mistyped into
# something equally well formed, renders identically to a correct one. Only
# Google can settle that, and it does: the property reads as unverified in
# Search Console. The checks below cover the failures that are SILENT.
#
# Modelled on lfr-tunnel's script of the same name, deliberately, so the
# repositories stay comparable. See #1312.
set -euo pipefail

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

# 1. Presence. Checked on every page rather than the home page alone: Google
#    accepts verification from the URL it was given, and a template change that
#    dropped the tag from inner pages while keeping it on the index would look
#    verified and read as broken to anything else.
unverified=$(grep -rL 'name="google-site-verification"' "$SITE" --include='*.html' || true)
if [ -n "$unverified" ]; then
    count=$(echo "$unverified" | wc -l | tr -d ' ')
    echo "[MISSING-VERIFICATION] ${count} page(s) lack the google-site-verification meta tag."
    echo "  Check extra.google_site_verification in ${CONFIG} and overrides/main.html."
    echo "  Pages affected:"
    echo "$unverified" | sed "s|^${SITE}/|    |"
    fail=1
fi

# 2. Value. Presence alone passes for a tag rendering the wrong thing: a
#    template that hardcodes a token, or interpolates a key that was renamed,
#    or emits content="" because someone removed the {% if %} guard. All three
#    look like a verified page to every check that only reads the source.
#
#    Only pages that HAVE the tag are compared, so a page missing it is
#    reported once above rather than twice.
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

if [ "$fail" -ne 0 ]; then
    echo
    echo "The published output does not match what the source asks for."
    exit 1
fi

echo "${pages} page(s) checked: every one publishes the configured token (${configured})."
