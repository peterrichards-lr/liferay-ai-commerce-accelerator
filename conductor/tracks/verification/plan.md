# Verification Track Implementation Plan

## Phase 1: Test Orchestration Scaffolding

- [x] Create `scripts/test-e2e-orchestrator.js`.
- [x] Implement microservice process management (spawn, pipe logs, wait for health).
- [x] Implement cleanup logic (kill microservice on exit).
- [x] Define environment variables for Liferay credentials.

## Phase 2: Playwright Logic (The "Puppeteer")

- [x] Implement `tests/e2e/auth.setup.js` for Liferay login.
- [x] Implement `tests/e2e/dashboard.spec.js`.
- [x] Create "Delete All Data" test case.
- [x] Create "Generation (Demo Mode)" test case.
- [x] Implement waiting logic for 100% progress.

## Phase 3: Forensic Log Analysis

- [x] Implement `scripts/analyze-e2e-logs.js` utility.
- [x] Add post-test step to scan logs for `FATAL`/`ERROR` strings.
- [x] Fail the test suite if critical logs are found.

## Phase 4: System Map & CI Integration

- [x] Update `SYSTEM_MAP.md` to include verification infrastructure.
- [x] Update `.github/workflows/ci.yml` to include the E2E verification step.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
