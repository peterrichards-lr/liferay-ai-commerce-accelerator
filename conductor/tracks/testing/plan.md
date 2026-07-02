# Track Implementation Plan: Microservice - Testing & Mocking

## Phase 1: Comprehensive MSW Handlers

- [x] Implement handlers for `Accounts` (REST & GraphQL).
- [x] Implement handlers for `Orders` (REST & GraphQL).
- [x] Implement handlers for `Pricing` (Price Lists, Price Entries).
- [x] Implement handlers for `Batch Engine` (Submit, Status, Import Task).

## Phase 2: Service Unit Tests

- [x] Test `PersistenceService` (SQLite interactions, schema init).
- [x] Test `CacheService` (TTL, cleanup).
- [x] Test `LiferayService` discovery methods (Products, Accounts, etc.).

## Phase 3: Generator Integration Tests

- [x] Test `AccountGenerator` end-to-end (with mocked Liferay and AI).
- [x] Test `ProductGenerator` end-to-end.
- [x] Verify correlation and callback handling in tests.

## Phase 4: Error Handling & Resilience

- [ ] Test retry logic in `LiferayService`. (Blocked: MSW `server.use` overrides not taking effect)
- [ ] Test failure paths in generators.
- [x] Verify `errorRef` generation and logging.

## Phase 5: Linting & Smoke Tests

- [x] Setup ESLint for Microservice, Frontend, and Configuration.
- [x] Configure `lint` scripts to run both ESLint and Prettier.
- [x] Setup Playwright for cross-component Smoke Tests.
- [x] Implement a "Happy Path" smoke test: Server Start -> UI Render -> Trigger Generation (Mocked).

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_
