---
name: documentation
description: Activate this skill after implementing code changes to verify, review, and update markdown documentation and timestamps.
---

# Documentation & Timestamp Hygiene Rules

To prevent documentation decay and ensure system configuration and architectural changes are accurately recorded, follow these active rules:

## 1. Proactive Documentation Review

After implementing any code change and before declaring a task finished, you MUST use Grep/Glob to identify relevant documentation, read the identified files, and analyze their contents. You are FORBIDDEN from reporting task completion until this context is loaded and timestamp footers are updated.

- **If no changes are needed**: The agent must still update the `*Last Reviewed: YYYY-MM-DD*` footer timestamp in the reviewed document to the current date.
- **If updates are required**: The agent must update the documentation content and change both `*Last Updated: YYYY-MM-DD*` and `*Last Reviewed: YYYY-MM-DD*` footer timestamps to the current date.
- **Scope**: A single code change may require updates to more than one document.

## 2. Missing Documentation

- If no documentation exists around the newly implemented change/feature, and it makes sense to document it (e.g., for architectural details, deployment instructions, or API usage), the agent should create a new Markdown document (`.md` file).
- If the new details fit better inside an existing document, add them as a new section or update existing sections accordingly.

## 3. Footer Formatting Standards

The footer format depends on whether the file is published to the documentation
site, because the site can generate one of the two dates and the repository
cannot.

**Published to the site** — anything under `docs/`. The site generates
"Last updated" from git history, so the footer carries the review date only:

```markdown
<!-- markdownlint-disable MD049 -->

---

_Last Reviewed: YYYY-MM-DD_
```

**Everywhere else** — `AGENTS.md`, `CONTRIBUTING.md`, `conductor/**`, and any
markdown outside `docs/`. Nothing generates an update date for these, so the
footer carries both:

```markdown
<!-- markdownlint-disable MD049 -->

---

_Last Updated: YYYY-MM-DD_ | _Last Reviewed: YYYY-MM-DD_
```

Both forms pass `scripts/check_docs_review.py`, which runs on every pull
request. A file with no review date at all fails it.

**A file you change must bump its own review date**, and that is now checked:
`check_docs_review.py --changed-since <base>` fails a pull request that edits a
document without moving its `Last Reviewed`. It exists because this rule was
broken by the commit that published it - #1298 added the disclaimer to
`README.md`, changed five lines, and left the footer at `2026-09-18`. Nothing
caught it, because `--max-review-days` asks whether a page is stale and that
date was a month old, not six.

### Why the review date stays manual

A commit timestamp says the file changed. It cannot say anyone read it. Fixing
one word moves "Last updated" and leaves "Last reviewed" where it was, which is
the honest outcome, because nothing was re-checked. That is the entire reason
the second date is typed by hand while the first is free.

### This rule is a public commitment

The documentation site's [About page](../../../docs/about.md) states that every
page shows when it was last updated and when it was last reviewed, and that the
reviews are carried out by the agents as part of keeping the docs current.

**Changing or bypassing this rule requires updating the About page in the same
pull request.** The page is a claim made to readers, not an internal note; a
rule that quietly stops being followed turns it into a false statement that
nothing would catch.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-10-15_ | _Last Reviewed: 2026-10-15_
