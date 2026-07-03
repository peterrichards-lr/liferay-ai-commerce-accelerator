# Project automation rules

All development, issue backlog prioritization, release workflows, and deployments MUST strictly follow the specifications defined in the [Automation Playbook](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/PLAYBOOK.md).

## Definition of Done (E2E Verification)

Before any feature, bugfix, or issue can be considered "code complete", the agent MUST run the local E2E Playwright test suite (`bash scripts/run-e2e-ldm.sh -v -k --ci`) and verify that all tests pass against a real Liferay DXP container. Do not declare a task finished or push final PRs until this E2E verification succeeds.

## Client Extension Routing Rules

When modifying `client-extension.yaml` files, **NEVER change or remove `.serviceAddress: localhost:3001` or `.serviceScheme`** manually to fix Docker or LDM routing issues. Liferay automatically updates the shared routes context with the correct internal endpoint when the generated `.zip` file is copied to the Liferay `osgi/client-extensions` deploy folder. Modifying these properties will override the auto-registration and break the deployment.

## Liferay Commerce Pricing v2.0 Constraints

When working with Liferay Commerce Pricing v2.0 (`/o/headless-commerce-admin-pricing/v2.0/`), **NEVER** use the SDK's `createPriceEntriesBatch` method or attempt to batch Price Entries directly.
The Pricing v2.0 single POST endpoint `/price-lists/by-externalReferenceCode/{erc}/price-entries` delegates internally to the Vulcan Batch Engine. However, a platform bug in Liferay DXP 2026.q1 causes the Vulcan Batch Engine to fail to propagate the `{erc}` path parameter properly, resulting in a `jakarta.ws.rs.NotSupportedException`.
**Constraint**: All price entries must be created via a sequential loop making direct HTTP POST requests to `this.liferay.rest._post`, and you MUST use the numeric ID endpoint `/price-lists/{priceListId}/price-entries` instead of the `by-externalReferenceCode` endpoint to completely bypass the Vulcan batch parameter mapping bug.
