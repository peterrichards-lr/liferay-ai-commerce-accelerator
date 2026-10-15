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
# Modelled on lfr-tunnel's script of the same name, deliberately, so the
# repositories stay comparable. See #1312.
set -euo pipefail

SITE="${1:-site}"

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

fail=0

# Search Console ownership token. Checked on every page rather than the home
# page alone: Google accepts verification from the URL it was given, and a
# template change that dropped the tag from inner pages while keeping it on
# the index would look verified and read as broken to anything else.
unverified=$(grep -rL 'name="google-site-verification"' "$SITE" --include='*.html' || true)
if [ -n "$unverified" ]; then
    count=$(echo "$unverified" | wc -l | tr -d ' ')
    echo "[MISSING-VERIFICATION] ${count} page(s) lack the google-site-verification meta tag."
    echo "  Check extra.google_site_verification in mkdocs.yml and overrides/main.html."
    echo "  Pages affected:"
    echo "$unverified" | sed "s|^${SITE}/|    |"
    fail=1
fi

if [ "$fail" -ne 0 ]; then
    echo
    echo "The published output does not match what the source asks for."
    exit 1
fi

echo "${pages} page(s) checked: verification tag present on every one."
