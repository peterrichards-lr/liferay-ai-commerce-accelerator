# Track Implementation Plan: Documentation & System Map

## Phase 1: System Map Update

- [x] Review current `SYSTEM_MAP.md`.
- [x] Add new services and utilities introduced during evolution.
- [x] Update frontend component hierarchy.

## Phase 2: Testing Documentation

- [x] Document the MSW mocking strategy. (Included in SYSTEM_MAP.md)
- [ ] Provide examples of adding new unit and integration tests.
- [ ] Document Playwright smoke test setup. (The instructions cited here lived in
      `GETTING_STARTED.md`, deleted in #244. `docs/QUICKSTART.md` documents the
      LDM-orchestrated e2e run and `docs/architecture/e2e-and-orchestration.md`
      covers the Playwright configuration, but the `yarn smoke` script itself is
      still undocumented.)

## Phase 3: Developer Experience

- [x] Update the installation and test commands. (Consolidated into
      `docs/QUICKSTART.md` by #244, which deleted `GETTING_STARTED.md`.)
- [x] Add a "Troubleshooting" section for common dev environment issues.
      (`docs/QUICKSTART.md`, "Known Issues & Troubleshooting".)

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-20_ | _Last Reviewed: 2026-09-20_
