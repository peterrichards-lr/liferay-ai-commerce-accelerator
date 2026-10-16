# Template Reference

This repo's AI-agent governance files (`AGENTS.md`, `.agents/`, `GEMINI.md`, `.claude/`) were established independently and have no automated relationship to any other repo. The **shared docs-site files are the exception**: they are copied from the template verbatim and compared by `scripts/check_template_drift.py`, which runs in the docs workflow. See the path mapping below and peterrichards-lr/ai-agent-template#135. `ai-agent-template` (https://github.com/peterrichards-lr/ai-agent-template) is maintained as the shared "lessons learned" reference for AI-agent rules across the Liferay tooling repos, but nothing here pulls updates from it automatically. This file is a manual checkpoint so drift gets tracked deliberately instead of silently.

**Reference repo**: <https://github.com/peterrichards-lr/ai-agent-template>
**Reference version at last check**: `v2.3.0+1` (origin/main @ `ed65da0`, 2026-10-16)
**Last checked**: 2026-10-16

## Path mapping

A governed file this repository keeps at a different path from the template, one per line as
`` `local path` ← `upstream path` ``. The drift checker compares the two files instead of
reporting one as missing and the other as extra.

- `docs/assets/stylesheets/liferay-blue.css` ← `.agents/templates/docs-profiles/liferay/liferay-blue.css`

The other three shared docs files - `overrides/main.html`,
`overrides/partials/copyright.html` and `scripts/mkdocs_github_alerts.py` - and
`scripts/check_docs_rendered.py` sit at the same path here as upstream and need no entry. LDM
maps the hook to `mkdocs_hooks/github_alerts.py`; this repository does not.

---

## Known drift as of this check

Both entries recorded at the v1.2.0 check ([#459](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/issues/459), [#460](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/issues/460)) are closed and are not repeated here.

**Shared docs-site files**: in sync. `check_template_drift.py --docs-site --fail-on-drift` compares all five against upstream HEAD and reports no drift; the docs workflow runs it on every pull request, so this line cannot go stale silently.

**This stamp is load-bearing, not decorative.** `docs/build` runs the drift check with `--against-recorded`, which compares the local copies against the upstream tree at the commit named above rather than at HEAD. A stale or wrong commit here changes what the deploy gate actually asserts, and `unknown` makes it exit 3 rather than pass. `docs/review` compares against HEAD, so an upstream merge still turns a check red and asks for a sync.

Six shared files, not five: [#149](https://github.com/peterrichards-lr/ai-agent-template/pull/149) added `scripts/check_template_drift.py` to the governed docs-site set. It compares the others, so an edit to it has to fail too - and before #149 its own list omitted itself, which meant a local copy could sit arbitrarily far behind and still report "no drift". This repository was 5153 bytes behind when that was found.

**The rest of the governed set**: six paths differ from upstream and are expected to. They are this repository's own, built long before the template governed them, and nothing in this migration touches them:

| Path                                     | Why it differs                                               |
| ---------------------------------------- | ------------------------------------------------------------ |
| `.github/workflows/ci.yml`               | this repo's build, test and Prettier jobs                    |
| `.github/workflows/docs.yml`             | the docs gates described above                               |
| `.github/workflows/issue-link-check.yml` | the `Closes`/`Refs` rule this repo enforces                  |
| `AGENTS.md`                              | this repo's own agent rules                                  |
| `scripts/append_timestamps.py`           | extended here                                                |
| `scripts/check_docs_review.py`           | extended here with `--changed-since` and `--max-review-days` |

Adopting any of them is a separate decision with its own issue, not a side effect of the docs-site migration.

## Skills available in the reference repo (for comparison; not all apply here)

`coding-standards`, `documentation`, `github-workflow`, `human-in-the-loop`, `multi-agent-orchestration`, `reflection-and-planning`, `release-management`, `rule-adherence`, `tool-use-react`, `unit-testing`

## How to use this file

Before writing a new agent rule here, check whether `ai-agent-template` already documents a corrected/newer version of the same rule. If you find and fix a real process bug in this repo, consider whether the same lesson belongs in `ai-agent-template` too, so future repos don't inherit the same bug.

Update the "Last checked" date and the drift list above whenever this comparison is repeated.

---

_Last Updated: 2026-10-16_ | _Last Reviewed: 2026-10-16_
