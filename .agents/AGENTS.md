# Moved

This file's content moved to [`/AGENTS.md`](../AGENTS.md) at the repository root,
so that agent tooling which auto-discovers `AGENTS.md` at the repo root (the
common cross-tool convention) finds it without needing a pointer from a
tool-specific file.

Kept here only as a redirect for anything that still links to this path
directly. Don't re-add rule content to this file — it previously lived only
here, off the auto-discovery path, and a bootstrap skill
(`.agents/skills/ensure-agents-md/`, now removed) would have regenerated an
incomplete version at the root if that file ever went missing, since it
never found this one. One canonical file per topic, linked rather than
restated, is the whole point of the root router.

See [`/AGENTS.md`](../AGENTS.md).

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-08-01_ | _Last Reviewed: 2026-08-01_
