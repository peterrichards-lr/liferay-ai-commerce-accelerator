# LDK Extraction Specification

## 1. Goal

Refactor the tightly-coupled `@liferay/accelerator-sdk` into a decoupled, platform-generic, and **Agentic-Friendly Liferay Development Kit (LDK)**. The LDK will serve as the unified integration layer for all future Node-based Liferay Client Extensions (CX).

## 2. Constraints & Rules

- **Decoupling State:** The LDK must accept abstract logging and storage interfaces via Dependency Injection. It must not rely directly on AICA's SQLite or WebSocket loggers.
- **Agentic-Friendly Signatures:** Every function must be fully documented with strict JSDoc annotations to enable IDE auto-completion and let LLMs discover parameter expectations.
- **Idempotency-by-Default:** Every write operation must check for existence (via ERC) and auto-convert to an update (`PATCH`) if the entity already exists.
- **Directory Layout:** The LDK code must be structured cleanly into `src/core/` (plumbing: oauth, rest, graphql, validator) and `src/services/` (domain services: commerce, platform, objects).

## 3. Scope

This track focuses entirely on the internal structural refactoring of the SDK package. It does not include new features or publishing the package to NPM (which will happen in a later phase when it moves to its own repo).

<!-- markdownlint-disable MD049 -->
---
*Last Updated: 2026-07-08* | *Last Reviewed: 2026-07-08*
