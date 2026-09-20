# Architecture Deep Dives

These are the detailed specifications behind the **[Architectural Overview](../ARCHITECTURE.md)**.

Read the overview first: it establishes the workflow engine, the entity
dependency graph and the WebSocket event contract that every document here
assumes. Each page below then specifies one subsystem in depth, and each is
written as a set of rules to follow rather than a narrative — they are the
constraints a change in that area has to satisfy.

| Document                                                           | Read it when you are…                                                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Microservice Architecture](./microservice-architecture.md)        | Changing the split between AICA and the shared `@liferay/accelerator-sdk`, or deciding which layer new code belongs in.                                            |
| [Workflow, State & Batching](./workflow-and-batching.md)           | Touching workflow state, batch correlation, WebSocket progress events, or how media is attached to entities.                                                       |
| [Liferay API Constraints](./liferay-api-constraints.md)            | Writing anything that filters or queries Liferay's Headless REST or GraphQL APIs. Explains the filter-in-memory mandate and the OData patterns that actually work. |
| [E2E Verification & LDM Orchestration](./e2e-and-orchestration.md) | Working on end-to-end verification, or on the Liferay Docker Manager (LDM) orchestration that drives it.                                                           |
| [Frontend & UI Standards](./frontend-and-ui.md)                    | Building or changing client-extension UI, and you need the layout, density and component conventions.                                                              |

## Related

- **[Architectural Overview](../ARCHITECTURE.md)** — start here.
- **[System Map](../SYSTEM_MAP.md)** — which client extension owns what.
- **[Upstream Bugs & Limitations](../upstream-bugs/index.md)** — the platform defects some of these constraints exist to work around.
- **[Documentation index](../README.md)** — all AICA documentation.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-20_ | _Last Reviewed: 2026-09-20_
