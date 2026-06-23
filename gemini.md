# Gemini Task State

## Current Goal

Automate fully populated E2E `.ldmp` packaging in CI/CD using LDM, and ensure all E2E verification tests (`yarn verify` / `run-e2e-ldm.sh`) pass successfully. Also, resolve local microservice startup connectivity issues when run outside LDM.

## Plan

1. **Document Platform Bugs**: Create a `jira` directory at the project root and add detailed markdown bug reports for: [Completed]
   - Pricing v2.0 single POST `NotSupportedException` bug.
   - GraphQL search index race condition / indexing lag.
   - GraphQL "Collection not allowed" query permissions error.
   - Warehouse Items batch endpoint mapping bug.
2. **Fix CLI Deletion Session ID Resolution**: Update `handleDelete` in `scripts/aica-cli.cjs` to check `res.sessionId || res.summary?.sessionId` so that it doesn't fail when the microservice wraps the session details under the `summary` block. [Completed]
3. **Fix E2E Test Ordering**: Update `playwright/tests/e2e/cli.spec.js` to run the `delete --all` test _before_ `import`, ensuring a clean DXP instance that avoids duplicate entity/account entry errors. Add a final `delete --all` test as a post-test cleanup step. [Completed]
4. **Fix createAccountsBatch Unit Test**: Correct the batch count returned when all accounts exist in `createAccountsBatch` (rest.cjs) so that it returns 0 for batch count instead of duplicating `toUpdate.length`. [Completed]
5. **Add Coverage Checking**: Install `@vitest/coverage-v8` to analyze the exact SDK test coverage. [Completed]
6. **Create OAuth Unit Tests**: Write unit tests for the SDK `OAuthService` under `tests/oauth.test.js` to cover caching, error recovery, client configurations, token exchange, and retry settings. [Completed]
7. **Create GraphQL Unit Tests**: Write unit tests for the SDK `LiferayGraphQLService` under `tests/graphql.test.js` to mock/validate queries, pagination, custom auth options, aliases, and error recovery. [Completed]
8. **Fix Pricing Batch Idempotency Test Payload**: Add `priceListExternalReferenceCode` to the `compliantPayload` and resolve a valid SKU ERC from Liferay dynamically in `playwright/tests/smoke/sdk-idempotency.spec.js` so Liferay's batch task executor can resolve both PriceList and Sku. [Completed]
9. **Resilient Product Batch Deletion**: Update `deleteProductsBatch` in `client-extensions/liferay-accelerator-sdk/src/liferay/index.cjs` to use `nativeBatch: false`. This aligns product deletion with all other entities, utilizing simulated batching which gracefully ignores missing products (404s) caused by Elasticsearch index lag. [Completed]
10. **Execute E2E Verification**: Run `bash scripts/run-e2e-ldm.sh -v -k` to confirm everything passes. [Completed]
11. **Fix CLI Import missing channelId/catalogId**: Destructure `liferayService` in `routes/import.cjs` and resolve missing `channelId` and `catalogId` from Liferay using the same fallback logic as `routes/generate.cjs` to support headless CLI imports. [Completed]
12. **Enable generatePriceLists and generateSkuVariants during CLI Import**: Set `generatePriceLists: true` and `generateSkuVariants: true` in `routes/import.cjs` session context options to ensure the pricing engine and SKU engine correctly create and resolve target lists and variant SKUs in `importMode`. [Completed]
13. **Increase E2E CLI Import Test Timeout**: Update the Playwright test `should successfully import and re-scaffold a dataset using config import` in `playwright/tests/e2e/cli.spec.js` timeout to 300000ms (5 minutes) to accommodate the additional scaffolding steps (price lists & SKUs creation). [Completed]
14. **Harden Deletion HTTP Logging**: Add all batch delete operations to `SOFT_STATUS_BY_OP` in `rest.cjs` mapping to `[403, 404]`, so they are soft-resolved as `INFO` logs instead of system `ERROR` logs. [Completed]
15. **Harden GraphQL Specification Query Logging**: Change GraphQL query exception logging in `graphql.cjs` from `error` to `warn` to prevent false-alarm alerts for handled queries. [Completed]
16. **Configurable Request Retries**: Add `LIFERAY_API_MAX_RETRIES` to `constants.cjs` and use it in `_request` (rest.cjs) and `processWithRetry` (misc.cjs) to allow customizing the transient error retry threshold. [Completed]
17. **Configurable Batch Deletion Threshold**: Add `LIFERAY_MAX_DELETION_ERRORS` to `constants.cjs` and enforce it in `_deleteByIds` (rest.cjs) to abort deletion flows if too many transient errors occur. [Completed]
18. **Configurable Batch Processing Threshold**: Add `LIFERAY_MAX_BATCH_ERRORS` to `constants.cjs` and pass it to `shouldStopBatch` in `batchProcessorService.cjs` to stop sequential runs after a configurable number of failures. [Completed]
19. **Unit Tests for Request Retries and Deletion Errors**: Add unit tests in `tests/resilience.test.mjs` to verify `LIFERAY_API_MAX_RETRIES` config override and `_deleteByIds` aborting when deletion errors meet threshold. [Completed]
20. **Unit Tests for Batch Processor Threshold**: Add a unit test in `tests/batchProcessorService.test.js` to verify `LIFERAY_MAX_BATCH_ERRORS` limits sequential execution. [Completed]
21. **Document Accounts Batch Upsert Limitation**: Create `jira/open/LPD-95079-ACCOUNTS-BATCH-UPSERT.md` detailing why the Headless Admin User accounts batch API needs upsert support. [Completed]
22. **Document Product Batch Delete Fragility**: Create `jira/open/LPD-95085-PRODUCTS-BATCH-DELETE-RESILIENCE.md` explaining why native product batch deletion should be resilient to missing items (404s). [Completed]
23. **Document Batch Delete Limitation**: Create `jira/open/LPD-95080-COMMERCE-BATCH-DELETE-LIMITATION.md` detailing the lack of unified native batch delete endpoints for commerce and admin-user entities. [Completed]
24. **Harden Account Batch Deletion soft statuses**: Add `400` to `SOFT_STATUS_BY_OP['accounts:batch-delete']` in `rest.cjs` to prevent default/system accounts deletion failures (which throw 400 Bad Request) from crashing the teardown flow. [Completed]
25. **Fix CodeMirror Version Mismatch & Workspace Duplication**: Downgrade `codemirror` from `6.0.2` to `5.65.16` in package files, remove the duplicate `"aica/client-extensions/ai-commerce-accelerator-microservice"` workspace from the root `package.json`, and fix the Liferay Workspace excludes glob to `**/aica/**` in `gradle.properties` to resolve build failures. [Completed]
26. **Fix Microservice Startup Probe URL Resolution**: Update `testConnection` in `rest.cjs` and `waitForLiferay` in `index.cjs` to resolve effective connection details so that raw environment variables or domain names (like `aica-e2e.local`) are parsed with valid protocol prefixes instead of causing `Invalid URL format` exceptions. [Completed]
27. **Fix tomcat/temp deletion on clean**: Recreate `bundles/tomcat/temp` before `setUpYarn` runs to prevent `NoSuchFileException` during clean builds. [Completed]
28. **Create non-technical interactive launcher script**: Add `start.sh` at the project root to provide an interactive, zero-dependency menu-driven bootstrap script for demo populating, UI launching, and diagnosing connectivity. [Completed]
29. **Fix rolldown native bindings architecture mismatch**: Move `@rolldown/binding-darwin-*` bindings to `optionalDependencies` in the root `package.json` to support both Gradle (x64) and system (arm64) Node architectures during install. [Completed]
30. **Document Feature Flags & Implement Boot Probe**: Document the required Page Management API Feature Flag (`LPD-35443`) in `docs/SETUP.md` and add a connection check in the microservice startup connection diagnostics (`testConnection`) to verify the flag is active on DXP. [Completed]
31. **Environment Configuration Split**: Rename `.env` to `.env.e2e` for the LDM E2E suite, create a new local `.env` pointing to `localhost:8080` with Basic Auth, and update the E2E script to prioritize `.env.e2e`. [Completed]
32. **Dashboard Failed Jobs Action Refactor**: Refactor list action button for failed jobs in System Administration Dashboard (`AdminApp.jsx`) to download session logs instead of exporting datasets. [Completed]
33. **Create AICA Developer Skill**: Create `.agents/skills/aica_developer/SKILL.md` to guide AI agents on standard scripts, environment constraints, and workflow commands. [Completed]
34. **Implement Unified Project Management & Automation Playbook**: Save `docs/PLAYBOOK.md`, add project-scoped rule to `.agents/AGENTS.md`, copy/implement `prioritize_issues.py` and `prioritize-issues.yml`, and create `bug_report.yml` and `feature_request.yml` issue templates. [Completed]
35. **Update Documentation for SE Context and Test Coverage Target**: Document the SE bootstrap/hosting options, Site Initializer, `.ldmp` packages, and target 40% test coverage goals. [Completed]
36. **Fix base64 length assertion in normalize.test.js**: Change `[REDACTED len=47]` to `[REDACTED len=50]` to pass tests. [Completed]
37. **Enforce SDK Coverage Threshold**: Configure `vitest.config.mjs` to enforce 40% statement/line coverage thresholds. [Completed]
38. **Create JIRA Tracker Skill**: Create `.agents/skills/jira_tracker/SKILL.md` to guide AI agents on documenting, naming, and categorizing upstream bugs/limitations in the repository. [Completed]
39. **Resilient E2E Environment Verification**: Update `scripts/run-e2e-ldm.sh` to log a warning instead of exiting when `ldm doctor` returns a non-zero exit code due to non-blocking environmental configuration warnings (e.g. missing osxkeychain helper under Colima). [Completed]
40. **Enforce JDK 11 Compatibility in E2E Script**: Configure `scripts/run-e2e-ldm.sh` to automatically detect and resolve `JAVA_HOME` to JDK 11 on macOS if available, avoiding compatibility failures with Gradle/Liferay workspace plugins when newer JVMs are active on the host. [Completed]
41. **Automate Fully Populated E2E Packaging in CI/CD**: Update AICA's GitHub Actions release workflow (`.github/workflows/release.yml`) to install LDM, initialize/boot the environment, wait for database readiness, and run `ldm package` to output a fully populated `.ldmp` package. [Completed]
42. **Fix JDK version mismatch in release workflow**: Add Setup Java 21 step to `.github/workflows/release.yml` to resolve LDM requirements mismatch on the GitHub runner. [Completed]
43. **Fix release packaging directory creation issue**: Create the `dist` directory in `release.yml` before running `ldm package` to prevent FileNotFoundError. [Completed]

## Current Progress

- Refactored `routes/config.cjs` to add POST handlers and created `tests/configRoutes.test.cjs` verifying local SQLite persistence (all 133 unit tests pass).
- Identified that Liferay Commerce Pricing v2.0's single POST endpoint `/price-lists/{id}/price-entries` delegates internally to the Vulcan Batch Engine, but fails to propagate the parent `id` path parameter. This causes the task executor to crash with:
  `jakarta.ws.rs.NotSupportedException: One of the following parameters must be specified: [externalReferenceCode]`
- Verified that target price list templates in `productGenerator.cjs` have `externalReferenceCode` populated, allowing us to route requests to the ERC-scoped path `/price-lists/by-externalReferenceCode/{externalReferenceCode}/price-entries` which cleanly propagates the parameter.
- Identified that `OrderGenerator.generateOrdersIndividually` invokes `ProgressService` progress logging methods (`batchStarted`, `batchProgress`, `batchCompleted`) without passing the required `sessionId`, which causes SQLite inserts to fail with `NOT NULL constraint failed: workflow_events.session_id`. Also, parameters for these calls were being passed in an obsolete two-argument format instead of a single object parameter.
- Identified that `aica import` fails with duplicate account entry errors on persistent DXP environments because Liferay's `/o/headless-admin-user/v1.0/accounts/batch` endpoint doesn't support updates/upsert. Fix: execute `delete --all` first to clean the environment.
- Identified that `aica delete --all` fails to submit because `routes/delete.cjs` returns the `sessionId` inside the `summary` property, whereas `scripts/aica-cli.cjs` expects it at the top level. Fix: fallback to checking `res.summary.sessionId`.
- Ran a full E2E test run (task `task-2672`). Verified that the SDK idempotency, dashboard, and initial CLI tests passed. The failures were indeed the duplicate account error during import (due to DXP containing dirty data) and the delete command session ID extraction failure.
- Fixed a bug in `createAccountsBatch` in [rest.cjs](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/client-extensions/liferay-accelerator-sdk/src/liferay/rest.cjs#L2050) where it double-counted updated accounts, causing the unit test `should return completed status immediately if all accounts already exist` to fail. All 88 SDK tests now pass cleanly.
- Installed `@vitest/coverage-v8` in the SDK and measured current statement coverage at **23.17%** (line coverage at **23.13%**).
- Created a comprehensive test suite for `OAuthService` in [oauth.test.js](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/client-extensions/liferay-accelerator-sdk/tests/oauth.test.js), achieving 52.44% statement coverage for oauth.cjs.
- Ran background E2E test task `task-4112` which failed on the Playwright test `should successfully import and re-scaffold a dataset using config import` due to target price lists not being created on DXP during import.
- Enabled `generatePriceLists: true` and `generateSkuVariants: true` during import sessions in `routes/import.cjs`.
- Ran background E2E test task `task-4224` which failed because the import Playwright test timed out after 120s. Backend logs verified the import session successfully completed (in 136s) but exceeded the test's hard limit due to the extra scaffolding steps. Plan: increase test timeout to 300,000ms.
- Identified that Dependabot upgraded `codemirror` from `5.65.16` to `6.0.2` in both root `package.json` and `client-extensions/ai-commerce-accelerator-configuration/package.json`. Because `react-codemirror2` (locked to `9.0.1`) requires CodeMirror 5, this caused compilation errors for classic CodeMirror imports (modes, addons, theme). Plan: Downgrade `codemirror` to `5.65.16`.
- Identified that `package.json` contains a duplicate workspace path `"aica/client-extensions/ai-commerce-accelerator-microservice"`. Since LDM copies source files into the `./aica` folder, registering it as a workspace causes Yarn to fail with a duplicate workspace name error during build. Additionally, the glob pattern in `gradle.properties` was `**/aica` instead of `**/aica/**`, which failed to exclude nested directory packages from Liferay Workspace scans. Plan: Remove the `"aica/..."` workspace entry from `package.json` and change the excludes glob to `**/aica/**` in `gradle.properties`.
- Fixed the `testConnection` and `waitForLiferay` logic to correctly resolve effective connection details including protocol matching.
- Updated `docs/SETUP.md` to document and include the `NODE_TLS_REJECT_UNAUTHORIZED=0` prefix for local development outside LDM.
- Identified that `tryBuildColocatedLiferayUrl` unit test failed due to `lookupConfig` mock returning `null` instead of the expected `'https'` protocol under test. Fixing by correctly mocking `lookupConfig` mock implementation inside `tests/utils.test.js`. [Completed]
- Identified that pre-push hook linting fails because the `coverage/` directory generated during local vitest coverage runs is not ignored by Prettier, causing style warnings on auto-generated HTML/CSS files. Fixing by adding `coverage/` to `.prettierignore` at the root. [Completed]
- Exclude the autogenerated Liferay client `GeneratedLiferayClient.cjs` from the Vitest unit test coverage report via `vitest.config.mjs`.
- Identified that the test `should sanitize nested objects and handle arrays` in `tests/normalize.test.js` fails because the mock base64 data URL string length is `50` characters, but the assertion expects `47`. Fixing it to expect `50`. [Completed]
- Achieved SDK statement coverage of **40.76%** (line coverage **40.91%**). Currently configuring `vitest.config.mjs` to enforce a 40% statement coverage threshold minimum.

## Secrets Leak Prevention (JS-Native Secrets Sentinel)

To prevent accidental leakage of sensitive credentials, API keys, and private tokens, this repository integrates a custom, zero-dependency **JS-Native Secrets Sentinel** (`scripts/detect-secrets.mjs`) directly into the Git pre-commit workflow.

### 🛡️ How It Works

- **Pre-commit Execution**: When a developer runs `git commit`, the `.husky/pre-commit` hook automatically executes the Node.js scanner on **Git staged files** (Added, Copied, Modified) in under 50ms.
- **Universal Portability**: Because it runs on pure Node.js, it works out-of-the-box on macOS, Windows, Linux, and inside clean CI/CD containers without requiring Python, pip, or Homebrew.
- **Target Patterns**: It matches and flags standard high-risk patterns:
  - OpenAI API keys (`sk-...`)
  - Gemini / Google API keys (`AIzaSy...`)
  - Anthropic API keys (`sk-ant-...`)
  - Private SSL/SSH keys (`-----BEGIN ... PRIVATE KEY-----`)
  - AWS access/secret keys (`AKIA...`)
  - GitHub Personal Access Tokens (`ghp_...`)
  - Raw credential assignments (e.g. `LIFERAY_API_PASSWORD="xyz"`)

### 💡 How to Approve a False-Positive

If the sentinel blocks a commit because it flags a safe false-positive (such as a mock variable or non-sensitive testing hash), developers have two simple ways to approve it:

1. **Inline Pragma**: Append an inline comment at the end of the flagged line:

   ```javascript
   const myMockApiKey = 'sk-proj-some-mock-key-value'; // pragma: allowlist secret
   ```

2. **Global Ignore File (`.gitleaksignore`)**: Add specific mock token substrings or file/folder wildcards to `.gitleaksignore` at the root of the repository to ignore them repo-wide:

   ```text
   # Mock SE Client Token (used in examples, README.md, and local testing)
   mock-se-client-token-12345

   # Workspace Unit Test and Mock Files
   client-extensions/**/*.test.js
   client-extensions/**/*.test.cjs
   client-extensions/**/*.test.mjs
   client-extensions/**/mocks/*
   ```

This is a standard, easy-to-use setup that the scanner natively respects, automatically bypassing the lines or files during audits.

## LDM Reference Documentation

- Main documentation entry point: [LDM README](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/README.md)
- Environment Architecture & Routing Visuals: [LDM Architecture](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/LDM_ARCHITECTURE.md)
- DNS & Client Extension routing rules: [LDM Networking & DNS Guide](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/guides/NETWORKING_DNS.md)
- Replicating Cloud envs locally: [LDM PAAS Local Dev Guide](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/guides/PAAS_LOCAL_DEV.md)

## LDM Interactive Constraints

When executing Liferay Docker Manager (LDM) commands or orchestration scripts (like `scripts/run-e2e-ldm.sh`) via the agent or in CI pipelines, you **MUST** ensure they run in non-interactive mode.

Failure to provide these flags will cause the execution to silently hang while waiting for STDIN prompts (such as project selection or confirmation dialogues).

- **For LDM commands:** Always append `-y` (e.g., `ldm down -y`, `ldm rm aica -y --delete`).
- **For Orchestration Scripts:** Always append `--ci` (e.g., `bash scripts/run-e2e-ldm.sh -v -k --ci`) to instruct the script to bypass its own interactive prompts and pass `-y` to underlying LDM commands.
