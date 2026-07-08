# Dataset Import Implementation Plan

## Phase 1: SDK & Infrastructure Preparation

- [x] Update `BaseGenerator` or `ProductGenerator` to support "import mode" (checking context for existing data).
- [x] Implement `NormalizationService` or similar utility to sanitize imported data (ERCs, I18n).

## Phase 2: Route Refactoring

- [x] Refactor `routes/import.cjs` to use the `WorkflowCoordinator` instead of direct `liferayService` calls.
- [x] Map import payloads to generator context keys (`productDataList`, etc.).

## Phase 3: Generator Hardening

- [x] Update `ProductGenerator` to skip AI generation if `productDataList` is provided.
- [x] Update `AccountGenerator` to skip AI generation if `accountDataList` is provided.
- [x] Update `OrderGenerator` to skip AI generation if `orderDataList` is provided.

## Phase 4: Verification

- [x] Create a sample import dataset.
- [x] Implement an E2E test for "Import Dataset" in `playwright/tests/e2e/import.spec.js`.
- [x] Verify that linking (Options, SKUs, Inventory) works correctly for imported data.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
