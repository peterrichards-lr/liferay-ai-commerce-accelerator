# Track: Site Initializer Foundation Fixes

## Status

- **Current State**: Site Initializer fails to load Master Page and Fragments.
- **Target State**: Site Initializer correctly applies the "AICA Minimal Master" page, publishes "Data Generator" and "Dashboard" pages, and correctly renders the custom fragments.

## Research Findings

1.  **Master Page ERC**: The `master-page.json` file is missing the `externalReferenceCode` field, which is required for layouts to reference it.
2.  **Fragment Nesting**: Liferay Site Initializers expect fragments to be in a `fragments/` subfolder within the collection folder (e.g., `fragments/group/my-collection/fragments/my-fragment/`).
3.  **Fragment References**: Page definitions should use `siteKey: "[$GROUP_KEY$]"` for group-scoped fragments and ensure correct case for `type: "Fragment"`.
4.  **Page Status**: Pages should have `"status": "published"` or similar if they are appearing as drafts.

## Implementation Tasks

### 1. Fix Master Page Definition

- [x] Update `site-initializer/layout-page-templates/master-pages/aica-master/master-page.json` to include `"externalReferenceCode": "aica-master-page"`.
- [x] Verify `page-definition.json` in the same folder is valid.

### 2. Restructure Fragment Directories

- [x] Create `site-initializer/fragments/group/ai-commerce-accelerator-fragments/fragments/` directory.
- [x] Move `ai-commerce-accelerator/` and `ai-commerce-accelerator-admin/` into the new `fragments/` subfolder.

### 3. Update Page Layouts

- [x] Update `site-initializer/layouts/1_data-generator/page.json`:
  - Change `"type": "content"` to `"type": "Content"`.
  - Ensure `"masterPageExternalReferenceCode": "aica-master-page"` is correct.
  - Update the fragment reference:
    - Change `type: "fragment"` to `type: "Fragment"`.
    - Add `"siteKey": "[$GROUP_KEY$]"` to the definition.
- [x] Update `site-initializer/layouts/2_dashboard/page.json` similarly.

### 4. Bug Fixes

- [x] Fix systemic `NoSuchFieldException` across multiple relationship entities:
  - [x] **Warehouse-Channel**: Removed ERC from linkage items in `WarehouseGenerator.cjs` and hardened `rest.cjs` with `skipItemERC: true`.
  - [x] **Inventory**: Removed ERC from items in `ProductGenerator.cjs` and hardened `rest.cjs` with `skipItemERC: true`.
  - [x] **Product Specifications**: Proactively removed ERC from nested items in `ProductGenerator.cjs`.
- [x] Fix `ValidationException: accountId unknown` in address batching by stripping path properties from payloads in `rest.cjs`.

### 5. Architectural Hardening

- [x] Implement `tests/contractCompliance.test.cjs` to validate all generated payloads against Liferay OpenAPI schemas during build.
- [x] Extend `tests/generatorParity.test.cjs` to programmatically verify that all `this.liferay.xxx` calls in generators exist in the service layer.
- [x] Harden `utils/payload-cleaner.cjs` to aggressively strip system IDs and illegal path properties.

### 6. Verification

- [ ] Run a build and deployment.
- [ ] Verify in Liferay:
  - Site "AI Commerce Accelerator" is created.
  - Pages are published.
  - Fragments are rendered on the pages.
  - Theme/Master Page styling is applied.
  - Warehouse-Channel linkage completes without error.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
