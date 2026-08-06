---
name: e2e-verification
description: Activate this skill when verifying changes, running E2E tests, or checking DoD requirements before PR creation.
---

# E2E Verification & Definition of Done

Before any feature, bugfix, or issue can be considered "code complete", the agent must ensure that all integration and verification gates pass.

## 1. Automated E2E Testing

- **Always required, and enforced by the required `CI/build-and-test` PR check**: lint (`yarn lint`) and the full unit test suite (`yarn test`). Run these locally before pushing.
- **Not a per-PR gate, but run it yourself when relevant**: the full Playwright E2E suite against a real Liferay DXP container takes ~1.5h, so it is intentionally NOT wired into PR CI — it runs nightly via `.github/workflows/e2e-verification.yml` (schedule-only, skips itself if nothing landed since the last successful run) instead. If your change touches generator/workflow logic, LDM integration, OSGi/client-extension deployment, or anything else this suite exercises, run it locally before declaring the task complete, since a regression there won't surface until the next nightly run otherwise:

  ```bash
  bash scripts/run-e2e-ldm.sh -v -k --ci
  ```

## 2. Post-Completion "Definition of Done"

- **Test Protocol**: Provide 3-5 manual/automated steps to verify in a live Liferay instance.
- **Redundancy Scan**: After a feature is complete, scan for any newly introduced duplicate code.
- **Strategic Deployment Control (No Automatic Deploy)**: Do not run or suggest `deploy` tasks as part of a general "build" command.
- **Dependency Awareness**: Before deployment, list the required order of execution (e.g., 1. OAuth2 CX, 2. Batch CX for Objects, 3. Frontend Custom Element).
- **Manual Trigger**: Always end a feature cycle by asking: "The code is ready and tested. Would you like me to provide the specific build/deploy commands for this extension now?"

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-08-06_ | _Last Reviewed: 2026-08-06_
