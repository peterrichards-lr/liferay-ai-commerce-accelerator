# Verification Track Specification

## Goal

Empirically verify the end-to-end "Delete" and "Generate" flows using Playwright and live microservice log monitoring to ensure the accelerator is rock-solid and stable across diverse environments.

## Scope

### 1. Test Orchestration

- A unified script to manage the lifecycle of the microservice and Playwright tests.
- Live log capture from the microservice for real-time and post-test forensic analysis.

### 2. End-to-End Scenarios

- **Authentication**: Reusable login setup for Liferay DXP.
- **Delete All Data Flow**:
  - Triggering deletion via the dashboard.
  - Verifying progress reaches 100%.
  - Verifying data removal via Headless APIs.
- **Generation Flow (Demo Mode)**:
  - Configuring a standard demo run.
  - Verifying workflow completion.
  - Verifying generated data consistency.

### 3. Forensic Log Analysis

- Scanning microservice logs for:
  - `FATAL` / `ERROR` levels.
  - Missing step handlers.
  - Unhandled promise rejections.
  - API communication failures.

## Technical Constraints

- **Liferay**: Must be accessible on `http://localhost:8080`.
- **Microservice**: Must be started as a standalone Node.js server.
- **Environment**: Node.js `20.12.2`.
- **Tooling**: Playwright, Vitest (for log analysis logic if needed).

## Definition of Done

- A single command can run the entire E2E verification suite.
- Both Delete and Generate flows are fully exercised.
- Any server-side error detected during the test causes the test to fail.
- CI pipeline executes these tests on every push to master.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
