---
name: docs-site-standard
description: >-
  Governs the shared MkDocs Material site standard: home-page layout, top-level navigation,
  GitHub alerts, the shared files and the rendered-output checks. Load whenever the docs site,
  its theme, home page, nav or shared files are touched.
---

# Skill: Documentation Site Standard

Projects bootstrapped with `--docs-site` share one site standard, so a reader moving between
them finds the same headings, navigation, callouts and footer. It was settled across three
sibling sites (liferay-docker-manager, liferay-ai-commerce-accelerator, lfr-tunnel) and moved
here because doing it by hand failed in specific ways: the three copies of the shared files
diverged within a day of parallel edits, decisions recorded only in issue comments were
missed or applied in a superseded form, and a spec described a hook's behaviour from memory
and was wrong (ai-agent-template#135).

The rules below are checked on the **built** site by `scripts/check_docs_rendered.py`, and the
shared files are held to the template by `scripts/check_template_drift.py`. A rule here that
the checks do not enforce is marked as such.

---

## Directives & Rules of Engagement

### 1. Home-page layout

Enabled per site with `extra.docs_standard.home_layout: true` in `mkdocs.yml`; checked as
`HOME-LAYOUT`.

1. **H1**: `<project name> documentation`, in sentence case. `project_name` comes from
   `extra.docs_standard.project_name` (the full name, not the repository slug), or `site_name`.
2. **Intro**: one paragraph saying what the project does.
3. **Notice** (optional): a project notice, rendered as an `info` callout above the first H2
   (rule 3).
4. **`## I want to…`** (anchor `#i-want-to`, with the Unicode ellipsis): directly followed by a
   table headed `I want to…` | `Go to`. Each row starts with a capital letter, as a verb
   ("Share my local site"), and has no trailing full stop.
5. **`## By subject`**: an index of the guides in unnumbered `###` subsections. It is a
   reader's index and may group pages differently from the nav.
6. **Project-specific sections** (optional): only between "By subject" and the related
   section.
7. **Related projects** (optional, last): the heading from `extra.docs_standard.related.heading`
   (for example "Related Liferay tools"), then the shared intro line, then a `Tool` |
   `What it does` table with the shared rows word for word. The current project's row is
   unlinked and its description starts `You are here.`.
8. **No emoji in any heading**, h1 to h6. © ® ™ are typography, not emoji.

### 2. Top-level navigation

Always checked, as `NAV`. In this order, with sentence-case labels; omit a section only when it
has no pages, and never rename or reorder one:

1. Home
2. Tutorials
3. How-to guides (second-level groups allowed, for example "Client" / "Server and operator")
4. Reference
5. Explanation
6. Troubleshooting (optional)
7. Showcase (optional, project-specific)
8. Project and contributing
9. About these docs (always last, and always present: every page's footer links to it)

- **Moves are nav-only.** Move the entry in `nav:`, never the file: a published URL must keep
  working.
- Which section a page belongs in is the Diátaxis decision in
  [`documentation/SKILL.md`](../documentation/SKILL.md). If a page mixes divisions, raise it
  rather than splitting it as part of a nav change.
- Labels below the top level are sentence case too ("Control plane setup"), and are checked.
  Acronyms (SSO) and inner-capital names (InfoSec) pass by their shape; any other proper noun
  a label needs mid-label goes in `extra.docs_standard.proper_nouns` (the Liferay profile lists
  `Liferay`). The page's own table of contents is not nav, and is not checked.
- **Index pages are optional, and render the same.** A section may have an index page
  (`navigation.indexes`, a `<section>/index.md` listed first under it) or not, and either kind
  is fine. A section title must look the same either way. Material renders a title with an
  index page as a link, in the primary text colour, and a title without one as a label, in the
  secondary colour. With one stylesheet, liferay-docker-manager had white titles and lfr-tunnel
  muted ones (ai-agent-template#143). The shared rule, `SECTION_TITLE_RULE` in
  `scripts/check_docs_rendered.py`, gives the link the label's colour at desktop width. Hover
  and the active page keep the link colour, so a title with an index page still reads as
  clickable. The Liferay profile's stylesheet carries the rule. Any other site that uses index
  pages adds it to its own stylesheet. Checked as `SECTION-TITLE`.

### 3. Alerts

The source is GitHub-native, `> [!NOTE]`, because contributors read it on github.com. The
alerts hook, `scripts/mkdocs_github_alerts.py`, converts it at build time:

| Source | Style | Title |
| :--- | :--- | :--- |
| `[!NOTE]` | `note` | Note |
| `[!TIP]` | `tip` | Tip |
| `[!IMPORTANT]` | `info` | Important |
| `[!WARNING]` | `warning` | Warning |
| `[!CAUTION]` | `danger` | Caution |

- **The title is GitHub's label**; only the style is borrowed from Material. An alert titled
  with the style name ("Info", "Danger") lost the author's word, and fails as `STYLE-TITLE`.
- **A strict title lift.** A first line of emoji, then a bold phrase, then an em dash
  (`> ℹ️ **Community project** — not an official…`) becomes the callout's title and renders as
  `info`, whatever the alert type. That is how a notice gets the `info` style, which GitHub has
  no alert type for.
- **Never relax the lift.** Measured on one adopter's 70 alerts: the strict rule lifts 1; a
  bold-lead-only rule lifts 29, turning sentences into headings
  (`**The bundle does not carry a DXP activation key, and cannot** — …`). The failure is silent,
  because every retitled callout still renders.
- A marker that reaches the reader as text fails as `LEAKED-ALERT`; a mermaid block rendered
  as code fails as `UNRENDERED-DIAGRAM`.

### 4. Shared files are never edited downstream

| File | Upstream path | Purpose |
| :--- | :--- | :--- |
| Alerts hook | `scripts/mkdocs_github_alerts.py` | Rule 3 |
| Rendered-output check | `scripts/check_docs_rendered.py` | Rule 5 |
| Theme override | `overrides/main.html` | Open Graph and Twitter tags, verification tags, favicons |
| Footer partial | `overrides/partials/copyright.html` | The "About these docs" link, through the `url` filter |
| Drift check | `scripts/check_template_drift.py` | This rule: it compares the others, so an edit to it must fail too |
| Liferay stylesheet | `.agents/templates/docs-profiles/liferay/liferay-blue.css` | Rule 6 |

A site's own extra override goes in `overrides/` beside them (Material has one `custom_dir`);
only the two override files above are governed there. `scripts/check_docs_review.py` is **not**
shared: adopters keep their own, which may diverge freely. A shared file never imports from a file
that is not shared, so the drift check defines its own footer pattern and ignore list, and an
adopter's `check_docs_review.py` cannot change what it compares (ai-agent-template#147).

- **Change them here, in a template PR, then copy them into each project unchanged.** Never
  edit a local copy to make a check pass, and never push a local edit upstream as if it were
  canonical. Per-site values go in `mkdocs.yml` (`extra:`), never in the files.
- **Site-specific styling** goes in a separate stylesheet listed after the shared one in
  `extra_css`.
- **A moved file is mapped, not renamed.** A project that keeps a shared file elsewhere (LDM
  keeps the hook at `mkdocs_hooks/github_alerts.py`) records `` `local` ← `upstream` `` in the
  "Path mapping" section of `.agents/TEMPLATE_REF.md`.
- **Docs CI runs the drift check on them**, and the shipped `.github/workflows/docs.yml` does
  so already:

  ```bash
  python3 scripts/check_template_drift.py --docs-site --fail-on-drift
  ```

  A mismatch prints both SHA-256 prefixes and sizes and exits 2. The template not found, or a
  shared path missing from it, exits 3. A network failure warns and exits 0. A profile
  stylesheet present locally but not mapped is named, with the mapping line to add, and exits
  3 with or without `--fail-on-drift`, like the other exit-3 cases: a deleted mapping would
  otherwise leave the shared stylesheet uncompared on a green run. It is found by its
  `docs-profile:` marker line anywhere in the repository, not only by its shipped name, so
  renaming or moving it does not hide it (ai-agent-template#162).
  The "copy the file FROM the template" direction is printed only for a shared file whose
  content differs.
- **Compare against the version you recorded, not the template's HEAD.** Compared against
  HEAD, a template merge that changes a shared file turns every adopter's docs PR red with no
  change on their side. Five template merges in one morning did exactly that
  (ai-agent-template#166). So PR CI and the deploy run the same command:

  | Where | Run |
  | :--- | :--- |
  | PR CI | `--docs-site --fail-on-drift --against-recorded` |
  | Deploy | `--docs-site --fail-on-drift --against-recorded` |

  `--against-recorded` compares against the commit in `.agents/TEMPLATE_REF.md`. A local edit
  to a shared file still fails, in both places. A template merge cannot.
  - **An `unknown` stamp** (a fresh project) has no recorded commit, so the run falls back to
    upstream HEAD, and says so. A recorded commit the template does not have exits 3.
  - **A newer release is a notice, not a failure.** When upstream has a newer release tag
    than the recorded version, the run names it and lists the shared files it changes, and
    exits 0. That is how an adopter learns the standard moved; the fix is a sync PR that
    copies the files in and runs `--update-stamp` in the same change. A sync that copies the
    files but forgets the stamp fails, because the copies then differ from the recorded
    commit.
  - The run never moves the stamp.

  The shipped `.github/workflows/docs.yml` is both: on a pull request it is PR CI (build, the
  rendered check, the drift check; nothing uploaded or deployed), and on a push to main it is
  the deploy. `--docs-site` arms both triggers.
- **Dependabot's pull requests skip the drift step**, with a step-level
  `if: github.event.pull_request.user.login != 'dependabot[bot]'`. A dependency bump changes no
  shared file, so the step has nothing to check, and a skipped step lets a required docs check
  report success rather than pending. They still build the site and run
  `check_docs_rendered.py`: dependency bumps are what break rendering.

### 5. Rendered-output checks

Run `scripts/check_docs_rendered.py _site` on the build output **before** the Pages upload,
never after. Configured from `mkdocs.yml`:

| Check | Runs when | Asserts |
| :--- | :--- | :--- |
| `LEAKED-ALERT`, `UNRENDERED-DIAGRAM`, `STYLE-TITLE` | always | Rule 3 |
| `UNDATED-PAGE` | always | every page shows both dates: `<p><em>Last Updated: …</em> \| <em>Last Reviewed: …</em></p>` in the body, or `<p><em>Last Reviewed: …</em></p>` in the body plus a date in Material's `<aside class="md-source-file">` |
| `ABOUT-LINK` | always | every page's footer link resolves to a built page, at every depth |
| `NAV` | always | rule 2 |
| `SECTION-TITLE` | a section has an index page | its title is in the markup `SECTION_TITLE_RULE` targets, and a stylesheet in `extra_css` carries the rule (rule 2) |
| `MISSING-VERIFICATION` | `extra.google_site_verification` / `bing_site_verification` | the tag on every page |
| `MISSING-SOCIAL` | `extra.social_image`, `extra.favicon_svg` or `theme.favicon` | what `overrides/main.html` emits, each part only when configured, on every page. `extra.social_image`: an absolute `og:image` that is in the build, `twitter:card` `summary_large_image`, and `twitter:image` equal to `og:image` (one edited without the other is drift). `extra.favicon_svg` and `theme.favicon`: the icon's `<link>`, resolving to a file in the build. Whenever it runs: the apple-touch-icon `<link>` and `assets/apple-touch-icon.png` |
| `NO-NOTICE` | `extra.docs_standard.notice` | an `info` callout above the first H2, with its title, text and link |
| `HOME-LAYOUT` | `extra.docs_standard.home_layout: true` | rule 1 |
| `REQUIRED` | `required` or `waive` is set | every name in them is a check above; every waive gives a reason and drops a check something requires |

**Deleting a key switches its check off**, and the build stays green: lfr-tunnel lost its Search
Console verification that way (lfr-tunnel#2381). So a check can be **required**, and a required
check fails under its own name, naming each missing key, instead of being skipped:

| Required check | Needs |
| :--- | :--- |
| `MISSING-VERIFICATION` | `extra.google_site_verification` or `extra.bing_site_verification` |
| `MISSING-VERIFICATION:google` / `:bing` | that token specifically. The Liferay profile requires `:google` |
| `MISSING-SOCIAL` | `extra.social_image`, `extra.favicon_svg` and `theme.favicon` |
| `NO-NOTICE` | `notice.title`, `notice.text` and `notice.link_text` |
| `HOME-LAYOUT` | `home_layout: true`, the `related` block, and its `heading`, `intro` and `rows` |

The sub-keys matter as much as the keys: a deleted `notice.text` or `related.heading` left the
check running and checking less, with exit 0 (ai-agent-template#155).

- **A profile requires its checks by default.** The Liferay profile requires all four (rule
  6). The site is known as a profile site by the `docs-profile: liferay` marker line inside
  `liferay-blue.css`, found anywhere in the built site, not by the file's name or how
  `extra_css` links it. A query string, a rename, a moved path, or dropping it from
  `extra_css` cannot switch the checks off. A copy from before the marker existed is still
  known by its name in `extra_css`. Deleting `required`, or a name in it, cannot turn one off
  either (ai-agent-template#164).
  A profile may require more of a check than the check's own keys: every Liferay profile
  site carries the related-tools rows, so HOME-LAYOUT needs the `related` block itself, and
  deleting the block (with the home page's section) fails (ai-agent-template#164).
- **A required check is required the same way, however it came to be.** Listing a check in
  `required` holds it to everything the profile default would, profile keys included,
  whether or not the profile is recognised: a site that lists HOME-LAYOUT needs the `related`
  block, even with the profile stylesheet dropped (ai-agent-template#175). A site with no
  related projects therefore does not list HOME-LAYOUT, or waives it with its reason.
- **A site drops a required check only by waiving it, with a reason.** A waive without a
  reason, or of a check nothing requires, fails as `REQUIRED`. A waived check still runs if it
  is configured; only the requirement goes.

  ```yaml
  extra:
    docs_standard:
      waive:
        MISSING-VERIFICATION: Not submitted to Search Console yet.
  ```

- **A specific token.** Plain `MISSING-VERIFICATION` is satisfied by either token, so a site
  that depends on Search Console requires `MISSING-VERIFICATION:google`: Bing's token in place
  of Google's passed with no Google tag on any page (ai-agent-template#161). Waiving
  `MISSING-VERIFICATION` waives its `:google` and `:bing` forms too; a profile site that does
  not use Search Console waives only `MISSING-VERIFICATION:google`, and still needs a token.
- **A site with no profile** lists what it cannot do without in `required`, for example
  `required: [MISSING-VERIFICATION:google, NO-NOTICE]`. An unknown name fails as `REQUIRED`; any other
  check above may be named, and changes nothing.

A build with fewer than 5 HTML pages fails as `NO-SCAN`.

`ABOUT-LINK` exists because `mkdocs build --strict` passes a relative footer link that 404s on
every nested page.

**Typing both dates and generating "Last updated" from git: both are allowed.** A site may type
both dates into every page's footer, or use `mkdocs-git-revision-date-localized-plugin` for the
first and type only `*Last Reviewed: YYYY-MM-DD*`. The generated date cannot drift from the
file, and a commit timestamp says the file changed, not that anyone re-read it, so the review
date is typed either way. `UNDATED-PAGE` finds the generated date by the aside's structure (a
`md-source-file__fact` holding text, not a contributors `<nav>`), not by its title: Material
localises that title ("Last update", "Letztes Update"). A page showing only one of the two dates
fails (ai-agent-template#142).

### 6. The Liferay profile

`bootstrap_template.py --docs-site --docs-profile liferay` applies it; the files are in
`.agents/templates/docs-profiles/liferay/`.

- **Palette**: `liferay-blue.css`. Light scheme with a #0B5FFF header and tabs (white text,
  5.13:1); dark scheme with a navy header, scoped to `slate`; links #0B5FFF / #5d9bff; navy
  footers. Needs `primary: custom` and `accent: custom`, which the profile sets.
  Carries `SECTION_TITLE_RULE` (rule 2), so section titles match with or without an index page.
- **Notice**, written straight after the home page's intro:

  ```markdown
  > [!NOTE]
  > ℹ️ **Community project** — not an official Liferay product and not covered by Liferay Support. [About this project](about.md)
  ```

  It renders as an `info` callout titled "Community project". The About page opening is
  seeded from the profile's `about.md`; the footer reads "A community project — not an
  official Liferay product".
- **Related Liferay tools**: the three rows in the profile's `site.yml`. Set
  `extra.docs_standard.project_name` to this tool's name as it appears there, so its row is
  the "You are here." one.
- **Its four checks are required, and start waived.** The profile requires `NO-NOTICE`,
  `HOME-LAYOUT`, `MISSING-VERIFICATION` and `MISSING-SOCIAL` (rule 5). A new project meets none
  of them yet, so its `site.yml` ships a `waive` entry for each, with its reason, and the first
  deploy passes. Delete a waive in the change that meets its check. For example, the notice and
  `home_layout: true` go in with the home page, and their two waives come out in the same change.
  A site that already follows the standard deletes them at once. Deleting a waive only ever turns
  a check on.
- **Branding**: each tool uses its own mark. No official Liferay logo or waffle in the header,
  favicon, social preview or README; "Liferay" appears in text only (Liferay brand ticket
  DESIGN-10350). Not checked.

### 7. Tooling traps

- **Prettier**: a repository that runs it lists the shared files in `.prettierignore`.
  Prettier rewrites them, and a byte-identical check then fails on formatting nobody intended.
  A repository without Prettier needs nothing.
- **ruff**: a repository that runs it sets `allowed-confusables = ["ℹ"]` under
  `[tool.ruff.lint]`, rather than rewording the hook's `ℹ` comments, which would break the
  byte-identical copy.
- **mkdocs 2**: the template's `.github/dependabot.yml` ignores `mkdocs` versions `>= 2` on its
  pip entry. mkdocs 2.0 removes the plugin system and rewrites theming, and Material for MkDocs
  warns that every plugin and theme override breaks with no migration path; the alerts hook and
  `overrides/main.html` are both. Patch and minor 1.x releases still come through. A site with
  its own Dependabot config adds the same `ignore` entry.

<!-- markdownlint-disable MD049 -->
---
*Last Updated: 2026-10-16* | *Last Reviewed: 2026-10-16*
