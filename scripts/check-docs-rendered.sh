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

# 3. Footer "About these docs" link, resolved per page.
#
#    This is the failure that motivated the check. `copyright:` is raw HTML and
#    MkDocs emits it verbatim, so a relative href in it is NOT rewritten per
#    page: `about/` worked at the site root and 404'd on all 25 pages below it.
#    Nothing could see it - check-docs-links.cjs walks markdown, and the link
#    only ever existed in mkdocs.yml and the built HTML.
#
#    The anchor is found by its TEXT, not its href: on the About page itself the
#    `url` filter renders a self-link as `./`, which no href-matching pattern
#    would recognise. The href is then resolved against the page's own directory
#    and the target must exist, so a wrong depth fails rather than only a
#    missing link. python3 does the resolving: `realpath -m` is GNU and absent
#    on macOS, and python is already required to build the site at all.
base_path=$(sed -n 's|^[[:space:]]*site_url:[[:space:]]*||p' "$CONFIG" | head -1 \
    | sed -e 's|^https\{0,1\}://[^/]*||' -e 's|/*$|/|')

if ! python3 - "$SITE" "$base_path" <<'PYCHECK'; then
import os, re, sys

site, base_path = sys.argv[1], sys.argv[2]
block_re = re.compile(r"md-copyright__highlight.*?</div>", re.S)
# The anchor whose visible text is the About link, however it is cased.
# Prettier formats the partial whitespace-sensitively and puts a newline
# INSIDE the closing tag - `</a\n>` - so a literal `</a>` matches nothing and
# every page reads as having no link. Hence `</a\s*>`.
anchor_re = re.compile(
    r'<a\b[^>]*?href="([^"]*)"[^>]*?>\s*About these docs\s*</a\s*>', re.I | re.S)

missing, unlinked = [], []
for root, _, files in os.walk(site):
    for name in files:
        if not name.endswith(".html"):
            continue
        path = os.path.join(root, name)
        with open(path, encoding="utf-8", errors="replace") as fh:
            html = fh.read()
        block = block_re.search(html)
        if block is None:
            continue  # no footer rendered on this page at all
        anchor = anchor_re.search(block.group(0))
        if anchor is None:
            unlinked.append(os.path.relpath(path, site))
            continue
        href = anchor.group(1).split("#")[0].split("?")[0]
        if href.startswith(("http://", "https://", "//", "mailto:")):
            continue  # absolute: nothing local to resolve
        if href.startswith("/"):
            # Material's 404 page uses root-absolute URLs on purpose, because it
            # is served from any depth. They carry the deployed subpath, which
            # is the site root on disk, so strip it before resolving.
            rel = href[len(base_path):] if href.startswith(base_path) else href.lstrip("/")
            target = os.path.normpath(os.path.join(site, rel))
        else:
            target = os.path.normpath(os.path.join(root, href))
        if os.path.isdir(target):
            target = os.path.join(target, "index.html")
        if not os.path.exists(target):
            missing.append((os.path.relpath(path, site), anchor.group(1),
                            os.path.relpath(target, site)))

if unlinked:
    print(f"[NO-ABOUT-LINK] {len(unlinked)} page(s) render a footer with no About link.")
    for page in unlinked[:10]:
        print(f"    {page}")
if missing:
    print(f"[BROKEN-ABOUT-LINK] {len(missing)} page(s) link to an About page that is not there.")
    print("  A relative href in `copyright:` is raw HTML and is not resolved per")
    print("  page; overrides/partials/copyright.html uses the `url` filter instead.")
    for page, href, target in missing[:10]:
        print(f'    {page}: href="{href}" -> {target} (missing)')
if unlinked or missing:
    sys.exit(1)
PYCHECK
    fail=1
fi

# 4. Branding assets, on every page and resolvable.
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

# 5. The social card, when one is configured.
#
#    og:image is what a link unfurls as in Slack, Teams and LinkedIn, and it is
#    the one tag whose absence is invisible from the site itself: every page
#    looks perfect while shared links degrade to a bare URL.
#    overrides/main.html guards the block on extra.social_image, so deleting
#    that key - or moving the file - drops the tags silently and keeps the
#    build green.
#
#    Only enforced when the key is set, so a site that has not made a card yet
#    is not failed for not having one.
social_image=$(sed -n 's|^[[:space:]]*social_image:[[:space:]]*||p' "$CONFIG" \
    | head -1 | sed -e "s/[\"']//g" -e "s/[[:space:]]*$//")
if [ -n "$social_image" ]; then
    if [ ! -f "${SITE}/${social_image}" ]; then
        echo "[SOCIAL-IMAGE-NOT-PUBLISHED] extra.social_image is '${social_image}', which is not in the built site."
        echo "  Shared links would unfurl with a broken image."
        fail=1
    fi
    missing_og=$(grep -rL 'property="og:image"' "$SITE" --include='*.html' || true)
    if [ -n "$missing_og" ]; then
        count=$(echo "$missing_og" | wc -l | tr -d ' ')
        echo "[NO-OG-IMAGE] ${count} page(s) carry no og:image although extra.social_image is set."
        echo "$missing_og" | head -5 | sed "s|^${SITE}/|    |"
        fail=1
    fi
fi

# 6. The community-project notice, as the home page RENDERS it.
#
#    The three sites agreed the rendered output, not the source syntax: an
#    `info` callout titled "Community project". The source is GitHub-native
#    `> [!NOTE]`, and `[!NOTE]` means `note` - a different colour and icon.
#    Only the lead emoji in scripts/mkdocs_github_alerts.py keeps it `info`.
#
#    That makes the agreed appearance depend on a hook, a lead emoji and a
#    title convention, any of which can be edited without touching this page.
#    Checking the source cannot see it; this checks what a reader sees.
if ! python3 - "$SITE" <<'PYNOTICE'; then
import re, os, sys

home = os.path.join(sys.argv[1], "index.html")
if not os.path.exists(home):
    print("[NO-HOME-PAGE] the built site has no index.html to check the notice on.")
    sys.exit(1)

with open(home, encoding="utf-8", errors="replace") as fh:
    html = fh.read()

block = re.search(r'<div class="admonition[^"]*">.*?</div>', html, re.S)
if block is None:
    print("[NO-COMMUNITY-NOTICE] the home page renders no admonition at all.")
    print("  Expected an `info` callout titled 'Community project'.")
    sys.exit(1)

got = re.sub(r"\s+", " ", block.group(0)).strip()
problems = []
if 'class="admonition info"' not in got:
    kind = re.search(r'class="admonition ([^"]*)"', got)
    problems.append(f"callout type is '{kind.group(1) if kind else '?'}', expected 'info'")
if '<p class="admonition-title">Community project</p>' not in got:
    title = re.search(r'admonition-title">([^<]*)<', got)
    problems.append(f"title is '{title.group(1) if title else '(none)'}', expected 'Community project'")
if "Not an official Liferay product and not covered by Liferay Support." not in got:
    problems.append("the disclaimer sentence is missing or reworded")
if "\u2139" in got or "**" in got:
    problems.append("the lead emoji or bold prefix was left in the body")
if not re.search(r'<a href="[^"]*about/?"', got):
    problems.append("no link to the About page")

if problems:
    print("[COMMUNITY-NOTICE-SHAPE] the home page notice does not match the agreed output.")
    for problem in problems:
        print(f"    {problem}")
    print(f"  rendered: {got}")
    sys.exit(1)
PYNOTICE
    fail=1
fi

# 7. The shared home-page layout.
#
#    The three Liferay tools sites agreed one structure so a reader moving
#    between them lands in the same place: the same H1 shape, the same anchors
#    in the same order, the same two table formats, and the same related-tools
#    table with the current tool unlinked. See #1330.
#
#    Asserted on the BUILT page because that is where the anchors exist. The
#    ids are generated from the heading text, so renaming a heading silently
#    moves an anchor that other pages and other sites may link to.
if ! python3 - "$SITE" <<'PYHOME'; then
import html as htmllib
import os, re, sys

home = os.path.join(sys.argv[1], "index.html")
if not os.path.exists(home):
    print("[NO-HOME-PAGE] nothing to check the layout on.")
    sys.exit(1)
with open(home, encoding="utf-8", errors="replace") as fh:
    page = fh.read()

# Material wraps the content; headings outside it (nav, footer) are not ours.
body = re.search(r'<article[^>]*>(.*?)</article>', page, re.S)
body = body.group(1) if body else page

def text(fragment):
    # Drop the permalink anchor Material appends, then tags, then entities.
    fragment = re.sub(r'<a[^>]*class="headerlink".*?</a>', "", fragment, flags=re.S)
    return htmllib.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()

problems = []

h1 = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.S)
WANT_H1 = "Liferay AI Commerce Accelerator documentation"
if h1 is None or text(h1.group(1)) != WANT_H1:
    problems.append(f"H1 is {text(h1.group(1))!r} if present; expected {WANT_H1!r}")

ids = re.findall(r'<h2[^>]*id="([^"]+)"', body)
WANT_IDS = ["i-want-to", "by-subject", "related-liferay-tools"]
present = [i for i in ids if i in WANT_IDS]
if present != WANT_IDS:
    problems.append(f"H2 anchors are {present}; expected {WANT_IDS} in that order")

tables = re.findall(r"<table>(.*?)</table>", body, re.S)
def headers(tbl):
    head = re.search(r"<thead>(.*?)</thead>", tbl, re.S)
    return [text(c) for c in re.findall(r"<th[^>]*>(.*?)</th>", head.group(1) if head else "", re.S)]

routing = next((t for t in tables if headers(t)[:1] == ["I want to\u2026"]), None)
if routing is None:
    found = [headers(t) for t in tables]
    problems.append(f"no table headed 'I want to\u2026' / 'Go to'; found {found}")
elif headers(routing) != ["I want to\u2026", "Go to"]:
    problems.append(f"routing table headers are {headers(routing)}; expected ['I want to\u2026', 'Go to']")

related = next((t for t in tables if headers(t) == ["Tool", "What it does"]), None)
if related is None:
    problems.append("no related-tools table headed 'Tool' / 'What it does'")
else:
    rows = re.findall(r"<tr>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>", related, re.S)
    names = [text(a) for a, _ in rows]
    WANT = ["Liferay Docker Manager", "Liferay AI Commerce Accelerator", "Liferay Tunnel"]
    if names != WANT:
        problems.append(f"related-tools rows are {names}; expected {WANT}")
    here = [i for i, (_, d) in enumerate(rows) if text(d).startswith("You are here.")]
    if len(here) != 1:
        problems.append(f"{len(here)} rows start 'You are here.'; expected exactly 1")
    else:
        # The current tool must be the unlinked one.
        if "<a " in rows[here[0]][0]:
            problems.append("the 'You are here.' row is a link; the current tool must be unlinked")
        for i, (cell, _) in enumerate(rows):
            if i != here[0] and "<a " not in cell:
                problems.append(f"row {names[i]!r} is not a link; only the current tool is unlinked")

EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2190-\u2BFF\u2139\uFE0F]")
for level in ("h1", "h2", "h3"):
    for m in re.finditer(r"<%s[^>]*>(.*?)</%s>" % (level, level), body, re.S):
        t = text(m.group(1))
        if EMOJI.search(t):
            problems.append(f"{level} contains an emoji: {t!r}")

if problems:
    print("[HOME-LAYOUT] the home page does not match the shared layout.")
    for problem in problems:
        print(f"    {problem}")
    sys.exit(1)
print("  home page: shared layout OK (H1, anchor order, both tables, no emoji in h1-h3).")
PYHOME
    fail=1
fi

# 8. Alert labels: GitHub's word, Material's style.
#
#    The canonical hook maps each GitHub alert type to the nearest Material
#    style and then supplies the GitHub label as the title, because Material
#    otherwise titles the box after the style: `[!IMPORTANT]` became "Info" and
#    `[!CAUTION]` became "Danger", losing the word the author chose. See the
#    decision on #1329.
#
#    AICA publishes no IMPORTANT or CAUTION alerts today, so this asserts
#    nothing on the current site - which is exactly why it is here. The next
#    page that adds one would otherwise ship titled "Info" with every check
#    green, and no reader would know the label had been dropped.
if ! python3 - "$SITE" <<'PYLABELS'; then
import html as htmllib
import os, re, sys

site = sys.argv[1]
pat = re.compile(r'<div class="admonition ([^"]*)">\s*(?:<p class="admonition-title">(.*?)</p>)?', re.S)
# The pairs Material produces when the hook forgets to pass a label.
BANNED = {("info", "Info"), ("danger", "Danger")}

offenders = []
for root, _, files in os.walk(site):
    for name in files:
        if not name.endswith(".html"):
            continue
        with open(os.path.join(root, name), encoding="utf-8", errors="replace") as fh:
            for cls, title in pat.findall(fh.read()):
                cls = cls.strip().split()[0] if cls.strip() else ""
                title = htmllib.unescape(re.sub(r"<[^>]+>", "", title or "")).strip()
                if (cls, title) in BANNED:
                    offenders.append((os.path.relpath(os.path.join(root, name), site), cls, title))

if offenders:
    print(f"[ALERT-LABEL-LOST] {len(offenders)} callout(s) are titled after the style, not the alert.")
    print("  [!IMPORTANT] must render ('info', 'Important') and [!CAUTION] ('danger', 'Caution').")
    print("  A bare `!!! info` lets Material title the box 'Info'.")
    for page, cls, title in offenders[:10]:
        print(f"    {page}: ({cls!r}, {title!r})")
    sys.exit(1)
PYLABELS
    fail=1
fi

if [ "$fail" -ne 0 ]; then
    echo
    echo "The published output does not match what the source asks for."
    exit 1
fi

echo "${pages} page(s) checked: every one publishes the configured token (${configured})."
