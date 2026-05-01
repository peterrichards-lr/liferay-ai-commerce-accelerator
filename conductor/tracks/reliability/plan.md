# Track Implementation Plan: Data Generation Reliability

## Phase 1: Mock Generator Validation

- [x] Create `generation.test.cjs`.
- [x] Implement AJV-based schema validation for Products, Accounts, and Warehouses.
- [x] Verify Liferay-specific constraints (ERC patterns, productType).

## Phase 2: AI Service Verification

- [x] Create `aiService.test.cjs`.
- [x] Setup MSW for network-level OpenAI mocking.
- [x] Verify handling of various AI response shapes.

## Phase 3: Alignment & Cleanup

- [x] Update `product.json` schema to include internal IDs.
- [x] Align generator ERC prefixes with test expectations.
- [x] Achieve 100% test pass rate for generation logic.

## Phase 4: API Alignment & Contract Verification

- [x] Audit `generation-schemas` against `api-schemas` (documented in `audit_report.md`).
- [x] Create `ContractValidator` utility using `ajv` and OpenAPI JSONs.
- [x] Implement outbound request validation in `liferay/rest.cjs` (dev/test mode).
- [x] Update MSW handlers in `tests/mocks/handlers.cjs` to enforce schema compliance.
- [x] Create `schemaAlignment.test.cjs` for meta-validation of generation schemas.
- [ ] Refactor `deepCleanIds` into a schema-aware `LiferayPayloadStandardizer`.
