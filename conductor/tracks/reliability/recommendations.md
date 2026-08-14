# Reliability & Quality Recommendations: API Contract Integrity

This document outlines strategic recommendations to address data mismatches and ensure the system is "rock solid" for production use.

> **Status as of 2026-08-14**: Recommendations #1 and #2 below are now implemented (see `services/contractValidator.cjs`, `tests/contractValidator.test.cjs`, `tests/schemaAlignment.test.cjs`, `tests/contractCompliance.test.cjs` — all passing). #3 is substantially implemented via `utils/payload-cleaner.cjs`'s `deepCleanIds`. #4 and #5 remain open, tracked as GitHub issues [#485](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/issues/485) and [#484](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/issues/484) respectively.

## The Core Problem: The Validation Gap

Currently, validation occurs in two disconnected silos:

1.  **Generation Phase**: Validates AI/Mock output against simplified `generation-schemas`.
2.  **Liferay API Phase**: Manually maps data to Liferay structures with no local verification against authoritative `api-schemas`.

**Mismatches** occur because the manual mapping logic in generators (e.g., `productGenerator.cjs`) and the simplified `generation-schemas` frequently drift from the strict requirements of Liferay's OpenAPI/GraphQL specs.

---

## 1. Implement Authoritative Contract Validation — ✅ Implemented

**Recommendation**: Every outbound request to Liferay must be validated against the `api-schemas/` specs at runtime (in development/test) and during unit tests.

### Actionable Steps

- **AJV for OpenAPI**: Use `ajv` to compile the authoritative OpenAPI JSON files.
- **Validation Middleware**: Create a `ContractValidator` utility that:
  - Intercepts outbound physical requests (in `liferay/rest.cjs`).
  - Identifies the target schema based on the URL path.
  - Validates the body and query parameters.
  - Throws a descriptive `ContractViolationError` if the payload is invalid.
- **Strict MSW Handlers**: Update `tests/mocks/handlers.cjs` to perform this validation. If a test sends invalid data, the mock should return a `400 Bad Request` with schema diffs, forcing the test to fail.

---

## 2. Automate Schema Alignment (Drift Detection) — ✅ Implemented

**Recommendation**: Ensure `generation-schemas` are always a valid subset of the Liferay `api-schemas`.

### Actionable Steps

- **Meta-Validation Test**: Create a new test file `tests/schemaAlignment.test.cjs` that:
  - Iterates through each `generation-schema`.
  - Finds the corresponding `component/schema` in the Liferay OpenAPI spec.
  - Programmatically verifies that every field in the generation schema exists in the API schema and has a compatible type.
- **Continuous Sync**: If Liferay updates their schemas (and we pull them into `api-schemas`), these tests will immediately flag which generators need updates.

---

## 3. Centralized Payload Normalization — ✅ Substantially implemented

**Recommendation**: Move away from manual object construction in every generator step.

### Actionable Steps

- **Refactor `deepCleanIds`**: Replace it with a `LiferayPayloadStandardizer` that knows the specific quirks of Liferay APIs (e.g., `productOptionValues` -> `optionValues`, or stripping IDs only where actually forbidden).
- **Schema-Driven Mapping**: Use the `x-class-name` or other metadata in the OpenAPI schemas to guide normalization.

---

## 4. Enhanced Batch Failure Observability — 🔲 Open (tracked as [#485](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/issues/485))

**Recommendation**: Automatically correlate Liferay "Import Task" failures with the original source data and schema definitions.

### Actionable Steps

- **Failure Report Enrichment**: When `getImportTaskFailedItemReport` detects an error, the microservice should:
  - Retrieve the original record from the `workflow_batches` context.
  - Run the local `ContractValidator` on it to see if we can catch the error locally.
  - Log a "Schema Correlation Report" that shows: "Liferay says X, our local validator says Y, original payload was Z".

---

## 5. GraphQL Query Integrity — 🔲 Open (tracked as [#484](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/issues/484))

**Recommendation**: Validate all GraphQL queries in `liferay/graphql.cjs` against `liferay_schema.graphql`.

### Actionable Steps

- **Build-time Check**: Use `graphql-inspector` or a similar tool in a CI/Test step to verify that all strings in our code matching `gql` patterns are valid according to the local schema file.

---

## Identified Contradictions & Risks

1.  **`productType` Constraint**: `gemini.md` states `productType: 'simple'` is mandatory for creation, but OpenAPI implies other values might be possible. The code currently follows the mandatory 'simple' rule, which is correct based on experience but contradictory to a "pure" schema-driven approach.
2.  **`title` vs `label`**: ~~In `ProductSpecification`, the generator uses `title`, while OpenAPI says `label`. This is a confirmed mismatch that needs resolution.~~ Re-checked 2026-08-14: `generators/product-steps/specifications.cjs` correctly uses `title` for the Specification Definition entity (line ~143) and `label` for the nested ProductSpecificationValue entity (line ~162) — these are two distinct Liferay entities with genuinely different field names, not a mismatch. `schemaAlignment.test.cjs` passes for `product.json`, which covers this. No longer believed to be an open issue.
3.  **ERC Priority**: The system is inconsistent in prioritizing numeric IDs over ERCs. Some steps use one, some the other. We need a strict "Numeric ID First" policy once IDs are resolved.

## Conclusion

The project has a strong architectural foundation. By bridging the gap between "what we generate" and "what Liferay specified" via **automated contract verification**, we can transform the current fragility into a "rock solid" reliability model.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-08-14_ | _Last Reviewed: 2026-08-14_
