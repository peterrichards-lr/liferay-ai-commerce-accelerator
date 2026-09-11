# Fallback Assets

This directory holds two committed fixtures and nothing else. **No runtime state lives here.**

## Files

### `mock-image.json`

A base64-encoded fallback image (WEBP), loaded by `generators/mediaGenerator.cjs` as the last resort when no default product image has been configured in Liferay.

### `mock-pdf.json`

A base64-encoded fallback PDF, used the same way for product attachments.

Both are loaded by relative `require`, so they are code rather than data — they are committed, and moving them means changing the generator.

## Where the state went

This directory used to hold the workflow database, and before that a `workflows.json` managed by `lowdb`. Neither is true now:

|                               | Now at                       | Why                                                                                                                                                                                                                            |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workflow database             | `~/.aica/data/workflows.db`  | Destroyed twice by ordinary tooling — once resolving inside `node_modules`, where every install removed it, then by `gradle clean`, which took a completed UAT run that was the source for a production promotion (#868, #869) |
| Generated and extracted media | `~/.aica/media/<sessionId>/` | Followed the database, for the same reason: a package is built from these binaries, so media a clean can remove is a promotion that arrives without its pictures (#899)                                                        |

Both paths are overridable — `PERSISTENCE_DB_PATH` and `MEDIA_ARCHIVE_PATH` — which is how a deployment points them at a mounted volume. An explicit setting always outranks the default, and media left at the old `./data/media` is moved to the new root once, at startup.

## Maintenance

- The fixtures are static resources; update them only when the default placeholder assets should change.
- To clear workflow state, delete `~/.aica/data/workflows.db` while the service is stopped — not this directory.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-11_ | _Last Reviewed: 2026-09-11_
