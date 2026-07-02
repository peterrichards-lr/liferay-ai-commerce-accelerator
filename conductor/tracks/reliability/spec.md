# Track Specification: Data Generation Reliability

## Objective

Ensure all generated data (AI and Mock) strictly adheres to authoritative schemas and Liferay Commerce business rules.

## Requirements

- Comprehensive schema validation using AJV.
- Verification of Liferay-specific constraints (e.g., `productType: 'simple'`).
- Consistent payload structures across Mock and AI generators.

## Success Criteria

- 100% schema compliance for all generated entity types.
- AI service verified with mocked LLM responses.
- Schema alignment with internal system data structures.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_
