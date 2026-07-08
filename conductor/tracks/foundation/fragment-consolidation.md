# Track: Fragment Consolidation & Build Alignment

## Status

- **Current State**: Fragments are being deployed twice (Globally via legacy Gradle ZIP and Site-Scoped via Site Initializer CX). Gradle build paths are broken due to recent directory restructuring.
- **Target State**: Fragments are only deployed via the Site Initializer CX. Build logic correctly syncs CSS to the restructured fragment folders.

## Research Findings

1.  **Duplication Source**: The root `build.gradle` contains a `zipFragments` and `autoDeployFragments` task that packages fragments into a legacy ZIP format and deploys them to `bundles/deploy`.
2.  **Global Scope**: The legacy ZIP uses `companyWebId: '*'` and no `groupKey`, forcing them into the Global scope.
3.  **Broken Paths**: The `FRAGMENTS_DIR` and `FRAGMENT_DIR` variables in `build.gradle` do not account for the mandatory `fragments/` subfolder added in the last refactor.
4.  **Incomplete CSS Sync**: The build currently only syncs CSS to the `ai-commerce-accelerator` fragment, but the `ai-commerce-accelerator-admin` fragment might also benefit from the shared frontend styles.

## Implementation Tasks

### 1. Fix Build Logic Paths

- [x] Update `build.gradle` to use the new fragment paths:
  - `FRAGMENTS_DIR` -> `.../fragments/group/ai-commerce-accelerator-fragments`
  - `FRAGMENT_DIR` -> `.../fragments/group/ai-commerce-accelerator-fragments/fragments/ai-commerce-accelerator`
- [x] Add `FRAGMENT_ADMIN_DIR` for the admin fragment.

### 2. Standardize CSS Syncing

- [x] Update `syncFragmentCssToFragment` to sync CSS to **both** fragment folders.
- [x] Ensure the sync task is still wired to the `buildSiteInitializerZip` task.

### 3. Deactivate Legacy Deployment

- [x] Remove or disable the `autoDeployFragments` task to prevent accidental global deployment.
- [x] (Optional) Update `zipFragments` to be an internal-only task or remove it.

### 4. Verification

- [ ] Run `gw clean assemble`.
- [ ] Verify `fragment.css` is present in both fragment folders under `site-initializer/`.
- [ ] Verify that no standalone fragments ZIP is created in the build directory unless explicitly requested.

## Definition of Done

- Fragments only appear within the "AI Commerce Accelerator" site.
- No "AI Commerce Accelerator" fragment set exists in Global fragments.
- Styles are correctly applied to both site fragments.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
