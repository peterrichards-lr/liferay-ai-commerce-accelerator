---
name: quality-guardrails
description: Activate this skill when adding new service endpoints, editing database layers, or preparing to commit changes.
---

# Quality Guardrails & Parity Testing

To prevent regression and ensure 100% architectural integrity, the following automated checks are mandatory:

## 1. Service Parity Testing

- **Rule**: Every public wrapper method in `LiferayService` (index.cjs) MUST have a corresponding implementation in either `LiferayRestService` or `LiferayGraphqlService`.
- **Enforcement**: Verified via `tests/serviceParity.test.cjs`. This prevents `TypeError: ... is not a function` errors when invoking headless wrappers.

## 2. Startup Step Verification

- **Rule**: Every workflow step registered in a Generator (e.g., `[S.CREATE_PRODUCTS]`) MUST be mapped to a valid class method.
- **Enforcement**: The `BaseGenerator.verifySteps()` method is called at boot time in `bootstrap.cjs`. The microservice will fail to start if any mapping is broken.

## 3. Pre-Commit Verification

- **Rule**: All code and documentation must be free of syntax errors, undefined references, and lint violations.
- **Enforcement**: Husky and `lint-staged` run `eslint --fix`, `vitest run`, and `markdownlint` on every commit. This catches `ReferenceError`, `SyntaxError`, and documentation drift before they reach the repository.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-19_ | _Last Reviewed: 2026-07-19_
