# Project automation rules

All development, issue backlog prioritization, release workflows, and deployments MUST strictly follow the specifications defined in the [Automation Playbook](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/PLAYBOOK.md).

## Definition of Done (E2E Verification)

Before any feature, bugfix, or issue can be considered "code complete", the agent MUST run the local E2E Playwright test suite (`bash scripts/run-e2e-ldm.sh -v -k --ci`) and verify that all tests pass against a real Liferay DXP container. Do not declare a task finished or push final PRs until this E2E verification succeeds.
