# Project automation rules

All development, issue backlog prioritization, release workflows, and deployments MUST strictly follow the specifications defined in the [Automation Playbook](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/PLAYBOOK.md).

## Definition of Done (E2E Verification)

Before any feature, bugfix, or issue can be considered "code complete", the agent MUST run the local E2E Playwright test suite (`bash scripts/run-e2e-ldm.sh -v -k --ci`) and verify that all tests pass against a real Liferay DXP container. Do not declare a task finished or push final PRs until this E2E verification succeeds.

## Client Extension Routing Rules

When modifying `client-extension.yaml` files, **NEVER change or remove `.serviceAddress: localhost:3001` or `.serviceScheme`** manually to fix Docker or LDM routing issues. Liferay automatically updates the shared routes context with the correct internal endpoint when the generated `.zip` file is copied to the Liferay `osgi/client-extensions` deploy folder. Modifying these properties will override the auto-registration and break the deployment.

## Engineering & Operational Rules

The following rules MUST be followed during development.

## Liferay Build Environment Constraints

- **Rationale**: The project requires modern frontend build tools (Vite 6, React 19) which are incompatible with the platform's default Node.js version. We have explicitly configured the environment to maintain parity with modern standards while adhering to Liferay Workspace limitations.
- **Node.js**: Enforced at `v22.22.2` via `build.gradle` `nodeVersion` configuration.
- **Build Infrastructure**: Standardized on Vite 6.0.0 and modern build dependencies across all client extensions to resolve native binary and ESM/CJS compatibility conflicts.
- **Test Pipeline**: The test suite is executed during the automated build pipeline. The known environment-level ESM loading issues (`ERR_REQUIRE_ESM`) in the test runner have been resolved with the upgrade to Node v22.
- **Guidance**: If build/deploy failures occur, always ensure the `.gradle/node` cache is cleared (`rm -rf .gradle/node`) before re-running the build to force synchronization with the project's enforced Node version.
- **Dismissal of Alerts**: Any dependabot alerts recommending upgrades for build tools should be reviewed against these pinned versions before applying.

---## Non-negotiable constraints

- All code must be **self-documenting** and contain **no comments**
- The AI agent must **not**:
  - build, deploy, or test the project
  - make source control changes (commits, reverts, rebases, etc.)
- The AI agent **should**:
  - perform dry code analysis
  - reason about control flow, concurrency, idempotency, and failure
    paths
  - surface likely bugs or race conditions early

---## Automated Quality Guardrails

To prevent regression and ensure 100% architectural integrity, the following automated checks are mandatory:

1.  **Service Parity Testing**:
    - **Rule**: Every public wrapper method in `LiferayService` (index.cjs) MUST have a corresponding implementation in either `LiferayRestService` or `LiferayGraphqlService`.
    - **Enforcement**: Verified via `tests/serviceParity.test.cjs`. This prevents `TypeError: ... is not a function` errors.
2.  **Startup Step Verification**:
    - **Rule**: Every workflow step registered in a Generator (e.g., `[S.CREATE_PRODUCTS]`) MUST be mapped to a valid class method.
    - **Enforcement**: The `BaseGenerator.verifySteps()` method is called at boot time in `bootstrap.cjs`. The microservice will fail to start if any mapping is broken.
3.  **Pre-Commit Verification**:
    - **Rule**: All code and documentation must be free of syntax errors, undefined references, and lint violations.
    - **Enforcement**: Husky and `lint-staged` run `eslint --fix`, `vitest run`, and `markdownlint` on every commit. This catches `ReferenceError`, `SyntaxError`, and documentation drift before they reach the repository.

---## Dependabot & Lockfile Integrity (Operational Rule)

- **Conflict Prevention**: To prevent 'npm_and_yarn' conflicts in CI and Dependabot, **NEVER** commit a `package-lock.json` file. Yarn is the authoritative package manager for this monorepo.
- **Explicit Scoping**: The `.github/dependabot.yml` file explicitly defines the ecosystem and directories for automated updates to ensure monorepo-wide consistency.

---## Native Identifier Strategy (Engineering Rule)

- **Eliminate `uuid` Dependency**: To reduce security surface area and avoid CommonJS/ESM compatibility friction, **DO NOT** use the `uuid` npm package in the microservice.
- **Authority**: Use Node.js's built-in **`crypto.randomUUID()`** for all random identifier generation (ERCs, correlation IDs, task IDs).

---## Clean Code & Linting (Engineering Rule)

- **Zero Warning Mandate**: The codebase must be free of lint warnings and formatting errors.
- **Intentional Omissions**: Use the **`_` (underscore)** prefix for any intentionally unused parameters, variables, or caught errors (e.g., `const { unused: _unused } = obj`, `catch (_err) {}`). The ESLint config is hardened to support this pattern without warnings.

---## Known Operational States

- **Demo Mode**: Uses deterministic ERCs for addresses. Repeated runs will trigger "Duplicate address" errors unless the database is cleared.
- **Liferay Password**: Default local development password is set to `L1feray$`.
- **Node Version**: v24.0.0+ is the current target; ensure native modules are rebuilt if switching environments.

---## Agent Analysis (Self-Correction & Findings)

### Deletion Discovery & Sequencing (Analysis Finding)

Analysis of the account deletion failure revealed a critical conflict between workflow sequencing and entity discovery logic:

1.  **Sequencing Dependency**: `deleteOrders` must precede `deleteAccounts` due to Liferay referential integrity.
2.  **Discovery Flaw**: `LiferayService.getAccounts` relies on querying existing orders when a `channelId` is provided. If orders are already deleted, discovery returns zero results.
3.  **Corrective Pattern (Comprehensive Manifest)**: Deletion discovery MUST perform a complete sweep of all entities (**Orders, Products, Accounts, Warehouses, Price Lists, Promotions, Specifications, and Options**) _before_ any deletion begins. This captures volatile IDs and relationships while links are still valid.
4.  **Property Resilience**: Discovery logic must check both `erc` and `externalReferenceCode` to account for variations in Liferay's Headless DTO property naming.

### Product Type Constraint (API Finding)

Investigation of product creation failures (`CPDefinitionProductTypeNameException`) revealed a critical API constraint:

1.  **Mandatory Type**: The Liferay Headless Commerce API requires the `productType` field to be `simple` for all products during initial creation.
2.  **Actionable Pattern**: All generator logic, AI prompts, and schemas must strictly use `productType: 'simple'`.

### SKU Property Constraints (API Finding)

1.  **Unsupported Fields**: The `Sku` DTO does not recognize an `active` property. Including it will cause import failure.
2.  **Activation Rule**: A SKU linked to a product with SKU-contributing options is active only if it has an explicit `skuOption` entry for **every** contributing option.

### Batch Engine Verb Support (Unusual Behavior)

- **Constraint**: Not all Liferay Batch Engine endpoints support the HTTP `DELETE` verb.
- **Example (v1.0 Legacy)**: Older commerce entities (Warehouses, Orders, Accounts, Specs, Options) often fail or ignore global batch 'DELETE' strategies. For these types, use **Simulated Batch Deletion** (sequential individual `DELETE` requests) to ensure 100% cleanup reliability and accurate progress reporting.

### Resilient Order Generation (Indexing Workaround)

1.  **The Race Condition**: Immediately after creating products and SKUs, Liferay's search index may not be updated. Queries like `getProductsWithSkus` may return 0 SKUs, causing order generation to crash with "No purchasable SKUs found."
2.  **The Solution (Context Merging)**: The generator now uses a **Session Context Fallback**. If the API returns incomplete data, the system automatically injects resolved SKU IDs directly from the persistent session memory (the `productDataList`).

### Security & History Hygiene (Operational Finding)

1.  **Purge Policy**: Sensitive files (`workflows.db`, `*.log`) must be purged from Git history using `git-filter-repo` if accidentally committed.
2.  **Resolution Lockdown**: Always use `resolutions` in root `package.json` to override nested vulnerabilities (e.g., `uuid`, `axios`, `braces`).
3.  **Lock File Single Source**: Maintain only `yarn.lock`. Delete `package-lock.json` to prevent CI conflicts.
4.  **CI Cleanup**: Delete any failed GitHub Action jobs (e.g., via `gh run delete`) to maintain a clean workflow history.

---

## Architectural Documentation

Please refer to the following documentation in `docs/architecture/` for detailed system constraints and architectural rules:

- [Workflow & Batching (WebSocket, Correlation, Media)](../../docs/architecture/workflow-and-batching.md)
- [Liferay API Constraints (OData, DTOs, Pricing, Glue)](../../docs/architecture/liferay-api-constraints.md)
- [E2E & Orchestration (LDM, Deployment Patterns)](../../docs/architecture/e2e-and-orchestration.md)
- [Frontend & UI Standards (Stylebook, UI/UX)](../../docs/architecture/frontend-and-ui.md)
- [Microservice Architecture (SDK, Storage, Providers)](../../docs/architecture/microservice-architecture.md)
