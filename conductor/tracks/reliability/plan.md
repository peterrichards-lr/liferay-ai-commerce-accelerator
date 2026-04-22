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
