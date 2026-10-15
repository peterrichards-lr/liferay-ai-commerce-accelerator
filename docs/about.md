# About these docs

Liferay AI Commerce Accelerator is a community project maintained by Peter
Richards. It is not an official Liferay product and is not covered by Liferay
Support. This documentation is written with the help of AI coding agents, with
the maintainer accountable for what ships. Each page shows when it was last
updated and when it was last reviewed (reviews are carried out by the agents as
part of keeping the docs current). Found something wrong or out of date?
[Open an issue](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/issues/new/choose).

## What the two dates mean

They answer different questions, and neither is a copy of the other.

| Footer line       | Where it comes from                          | What it tells you                                                  |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| **Last updated**  | the file's git history, read at build time   | the page changed — by anyone, for any reason, including a typo fix |
| **Last reviewed** | written into the page by whoever reviewed it | someone read the whole page against the code as it stands          |

A commit is not a review. Correcting one word moves **Last updated** and leaves
**Last reviewed** where it was, which is the honest outcome: nothing was
re-checked. That distinction is the only reason the second date is maintained
by hand when the first is free.

## How these statements are enforced

Every claim above that describes a process is checked in CI rather than
asserted here. The ones that are not checkable are statements of fact, and are
marked as such.

| Statement on this page                       | What holds it up                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Not an official Liferay product              | a statement of fact; nothing to enforce                                                                                    |
| Written with the help of AI coding agents    | a disclosure of provenance; nothing to enforce                                                                             |
| The maintainer is accountable for what ships | the `Protect Master Branch` ruleset: no direct pushes, no force-pushes, a pull request and passing checks for every change |
| Each page shows when it was last updated     | `mkdocs-git-revision-date-localized`, from git history, on every build                                                     |
| Each page shows when it was last reviewed    | `scripts/check_docs_review.py`, which fails CI on any document with no review footer                                       |
| Reviews keep the docs current                | the same script with `--max-review-days`, which fails CI when a review goes stale                                          |

The rule those checks enforce is
[the documentation skill](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/blob/master/.agents/skills/documentation/SKILL.md):
an agent that reads a document while making a change updates its review date
**even when nothing needed changing**. So the dates move as a side effect of
ordinary work rather than needing separate discipline.

This page is held to the same standard it describes. It carries the same
footer and is checked by the same script.

## What this page does not promise

Reviews are carried out by agents, not by a line-by-line human read. The
maintainer is accountable for what ships, which is not the same as having
personally verified every sentence. If something here is wrong, it is worth
reporting rather than assuming it was deliberate.

<!-- markdownlint-disable MD036 MD049 -->

---

_Last Reviewed: 2026-10-15_
