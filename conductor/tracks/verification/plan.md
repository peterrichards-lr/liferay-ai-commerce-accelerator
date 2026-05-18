# Verification Track Implementation Plan

## Phase 1: Test Orchestration Scaffolding

- [ ] Create `scripts/test-e2e-orchestrator.js`.
- [ ] Implement microservice process management (spawn, pipe logs, wait for health).
- [ ] Implement cleanup logic (kill microservice on exit).
- [ ] Define environment variables for Liferay credentials.

## Phase 2: Playwright Logic (The "Puppeteer")

- [ ] Implement `tests/e2e/auth.setup.js` for Liferay login.
- [ ] Implement `tests/e2e/dashboard.spec.js`.
- [ ] Create "Delete All Data" test case.
- [ ] Create "Generation (Demo Mode)" test case.
- [ ] Implement waiting logic for 100% progress.

## Phase 3: Forensic Log Analysis

- [x] Implement `scripts/analyze-e2e-logs.js` utility.
- [x] Add post-test step to scan logs for `FATAL`/`ERROR` strings.
- [x] Fail the test suite if critical logs are found.

## Phase 4: System Map & CI Integration

- [x] Update `SYSTEM_MAP.md` to include verification infrastructure.
- [x] Update `.github/workflows/ci.yml` to include the E2E verification step.
