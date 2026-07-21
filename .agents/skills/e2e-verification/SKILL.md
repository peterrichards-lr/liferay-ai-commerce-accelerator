---
name: e2e-verification
description: Activate this skill when verifying changes, running E2E tests, or checking DoD requirements before PR creation.
---

# E2E Verification & Definition of Done

Before any feature, bugfix, or issue can be considered "code complete", the agent must ensure that all integration and verification gates pass.

## 1. Automated E2E Testing

Run the local E2E Playwright test suite against a real Liferay DXP container:

```bash
bash scripts/run-e2e-ldm.sh -v -k --ci
```

Before declaring any feature or bugfix 'code complete', you MUST execute `run_command` to invoke the command above, and END your turn. You are FORBIDDEN from declaring the task finished or pushing PRs until you receive the output confirming the E2E verification succeeded.

## 2. Post-Completion "Definition of Done"

- **Test Protocol**: Provide 3-5 manual/automated steps to verify in a live Liferay instance.
- **Redundancy Scan**: After a feature is complete, scan for any newly introduced duplicate code.
- **Strategic Deployment Control (No Automatic Deploy)**: Do not run or suggest `deploy` tasks as part of a general "build" command.
- **Dependency Awareness**: Before deployment, list the required order of execution (e.g., 1. OAuth2 CX, 2. Batch CX for Objects, 3. Frontend Custom Element).
- **Manual Trigger**: Always end a feature cycle by asking: "The code is ready and tested. Would you like me to provide the specific build/deploy commands for this extension now?"

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-19_ | _Last Reviewed: 2026-07-19_
