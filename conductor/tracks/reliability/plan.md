# Track: Codebase Deduplication & Architectural Cleanliness

## Status

- **Current State**: Significant duplication in Site Initializer configurations, Microservice Generators, and Batch Data. AI Prompts and Schemas are stored in two places (source code and Liferay Objects), risking drift.
- **Target State**: Dry, maintainable architecture with clear sources of truth and centralized logic.

## Research Findings

1.  **Fragment Configuration**: `ai-commerce-accelerator/configuration.json` and `ai-commerce-accelerator-admin/configuration.json` are 100% identical.
2.  **Generator Boilerplate**: All generator subclasses (`ProductGenerator`, `AccountGenerator`, etc.) repeat the same `runWorkflow` and session initialization logic.
3.  **Prompt & Schema Drift**: AI Prompts (`prompts/*.md`) and Schemas (`generation-schemas/*.json`) are duplicated inside Liferay Batch files (`10-15-*.json` and `04-09-*.json`).
4.  **Batch File Fragmentation**: Multiple files exist for the same Liferay Object type (`C_AICAConfiguration`), leading to maintenance overhead.

## Implementation Tasks

### 1. Site Initializer Refactoring

- [ ] Centralize common fragment configuration fields.
- [ ] Explore using a single fragment with different configuration defaults if possible, or sharing the `configuration.json` via a symlink/shared build step.

### 2. Microservice Generator Refactoring

- [x] Refactor `BaseGenerator` to handle `runWorkflow` boilerplate.
- [x] Parameterize session creation, progress reporting, and step execution.
- [x] Centralize `_runInterServiceSyncDelayStep` and other common utilities.

### 3. Prompt & Schema Source of Truth

- [ ] Establish `client-extensions/ai-commerce-accelerator-microservice/prompts/` and `generation-schemas/` as the authoritative source.
- [ ] **Optional/Advanced**: Create a script to generate the Liferay Batch JSON files from these source files to ensure they never drift.
- [ ] Update `ConfigService` in the microservice to prioritize Liferay Object overrides but fall back to local files cleanly.

### 4. Batch Data Consolidation

- [ ] Merge `10-object-entry-ai-prompt-*.json` files into `10-object-entry-ai-prompts.batch-engine-data.json`.
- [ ] Merge `04-object-entry-ai-schema-*.json` files into `04-object-entry-ai-schemas.batch-engine-data.json`.

### 5. Payload Standardization

- [ ] Implement `LiferayPayloadStandardizer` (from Reliability recommendations) to replace redundant `deepCleanIds` calls and manual mapping.

## Verification

- [ ] Ensure `yarn lint` passes with zero warnings.
- [ ] Run `tests/serviceParity.test.cjs` (if implemented) or existing unit tests to ensure no regression.
- [ ] Deploy site initializer and verify all fragments still function with their configurations.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
