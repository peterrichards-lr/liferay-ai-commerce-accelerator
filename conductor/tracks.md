# Tracks Registry

| ID                 | Title                            | Status    |
| :----------------- | :------------------------------- | :-------- |
| foundation         | Project Foundations & Tooling    | COMPLETED |
| testing            | Microservice - Testing & Mocking | COMPLETED |
| reliability        | Data Generation Reliability      | COMPLETED |
| frontend           | Frontend - Testing & Evolution   | COMPLETED |
| docs               | Documentation & System Map       | COMPLETED |
| verification       | End-to-End Verification          | COMPLETED |
| imports            | Dataset Imports                  | COMPLETED |
| ldk-extraction     | Agentic-Friendly LDK Refactoring | MOVED     |
| persona-orders     | AI Persona Order Seeding         | PLANNED   |
| multimodal-seeding | Multimodal Product Enrichment    | PLANNED   |
| multi-catalog      | Multi-Catalog & Multi-Brand      | PLANNED   |

**MOVED** means the work, if it is done, belongs to another repository. The
SDK left this one in #198 (2026-06-30) and is now
`peterrichards-lr/liferay-accelerator-sdk`, consumed as a git dependency. The
LDK refactor was planned against its old in-repo path and was never carried
out there: as of v0.12.8 there is no `src/core/`, no `LiferayLDK` facade, and
`src/liferay/rest.cjs` is still one 3,199-line service. Whether to do it is the
SDK's decision, not an AICA track.

The three PLANNED tracks have a spec and a plan under `tracks/<id>/`, drafted
2026-11-17 for the maintainer's review. Each ends with open questions that need
answers before any code.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-11-17_ | _Last Reviewed: 2026-11-17_
