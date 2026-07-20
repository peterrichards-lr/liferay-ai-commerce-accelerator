---
name: coding-standards
description: Activate this skill when writing or refactoring microservice and SDK javascript/typescript source files.
---

# Coding & Clean Code Standards

All code contributions must follow these clean coding standards:

## 1. Code Style & Self-Documentation

- **No Comments**: All code must be **self-documenting** and contain **no comments**.
- **Zero Warning Mandate**: The codebase must be free of lint warnings and formatting errors.
- **Intentional Omissions**: Use the **`_` (underscore)** prefix for any intentionally unused parameters, variables, or caught errors (e.g., `const { unused: _unused } = obj`, `catch (_err) {}`). The ESLint config is hardened to support this pattern without warnings.

## 2. Agent Constraints

The AI agent must **not**:

- make source control changes (commits, reverts, rebases, etc.) autonomously.
- bypass verification gates.

The AI agent **should**:

- perform dry code analysis.
- reason about control flow, concurrency, idempotency, and failure paths.
- surface likely bugs or race conditions early.

## 3. Native Identifier Strategy

- **Eliminate `uuid` Dependency**: To reduce security surface area and avoid CommonJS/ESM compatibility friction, **DO NOT** use the `uuid` npm package in the microservice.
- **Authority**: Use Node.js's built-in **`crypto.randomUUID()`** for all random identifier generation (ERCs, correlation IDs, task IDs).

## 4. Technical Debt Tracking

- **Detect & Record**: If you identify code smells, over-complexity, or potential refactoring opportunities during development, you must raise a GitHub issue with the `tech debt` label.
- **Immediate Resolution**: You do not need to resolve the technical debt immediately. However, if it can be resolved quickly without significant deviation or effort from the primary task, you may do so. The primary requirement is to ensure it is recorded.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-20_ | _Last Reviewed: 2026-07-20_
