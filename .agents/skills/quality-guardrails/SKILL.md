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

## 3. Pre-Commit & Pre-Push Verification

- **Rule**: All code and documentation must be free of syntax errors, undefined references, and lint violations before they reach the repository.
- **Enforcement**: This is split across two Husky hooks with different scope, so that fast, iterative commits aren't blocked on the full test suite:
  - **`.husky/pre-commit`**: Runs `lint-staged` (`eslint --fix`, `prettier`, `markdownlint` on staged files only) plus `scripts/detect-secrets.mjs`. This catches `ReferenceError`, `SyntaxError`, and documentation drift on every commit.
  - **`.husky/pre-push`**: Runs the full project lint (`yarn lint`) and the full unit test suite (`yarn test`, i.e. `vitest run`) before code leaves the machine.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-08-06_ | _Last Reviewed: 2026-08-06_
