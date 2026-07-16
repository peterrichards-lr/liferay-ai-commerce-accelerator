## E2E Verification & LDM Orchestration

To ensure production-parity verification, the project includes an automated orchestrator using **Liferay Docker Manager (LDM)**.

### 1. Environment Hardening

- **Version Gate**: Minimum LDM version `2.5.4` is enforced.
- **Fail-Fast**: The orchestrator runs `ldm doctor --skip-project` and verifies hostname resolution before attempting a boot, preventing wasted startup time on misconfigured hosts.

### 2. Filesystem Resilience (The SanDisk Rule)

Running Liferay Docker containers from external drives (common on macOS) often triggers fatal OSGi locking errors (`Unable to create lock manager`).

- **The Strategy**: The orchestrator script automatically detects if the workspace is located on an external volume (`/Volumes/`).
- **The Fix**: It dynamically patches the LDM-generated `docker-compose.yml` to remove bind-mounts for **`osgi/state`** and **`data`**. This forces Docker to use internal, high-performance **Anonymous Volumes** for these high-I/O directories, ensuring 100% boot stability regardless of the physical drive format.

### 3. Automated Setup Optimization

- **Database**: Standardized on **`postgresql`** for E2E tests to bypass the mandatory password reset prompt enforced by Hypersonic on first login.
- **Boot Performance**: Uses `--sidecar` for faster deployment monitoring and `--no-captcha` to streamline automated authentication flows.

### 4. Responsive Visual Auditing

- **Device Profiles**: Playwright is configured to run tests across **Desktop Chrome**, **iPhone**, **Pixel**, and **iPad**.
- **Visual Evidence**: Automated full-page snapshots are captured for every screen and responsive state, saved to the `test-results/` directory for manual verification.

---## The "Staging & Atomic Move" Deployment Pattern

To prevent race conditions with Liferay's aggressive auto-deployers (e.g., `FragmentFileInstaller`), all automated Docker deployments MUST follow the Staging & Atomic Move pattern.

### 1. The Problem: `docker cp` Race Condition

When running `docker cp <local_file> <container>:/opt/liferay/deploy/`, Docker performs two steps:

1.  **Stream Data**: Writes the file content.
2.  **Finalize Metadata**: Sets ownership and permissions (`lchown`).

If Liferay's watcher detects and moves the file after Step 1 but before Step 2, Docker fails with: `Error response from daemon: failed to Lchown ... no such file or directory`.

### 2. The Solution: Implementation Steps

- **Stage**: Copy the artifact to a non-watched temporary directory (e.g., `/tmp/aica-staging`).
- **Atomic Move**: Use `docker exec` to move the file into the target directory in a single operation.

```bash
# Example
docker exec <container> mkdir -p /tmp/aica-staging
docker cp ./artifact.zip <container>:/tmp/aica-staging/
docker exec -u 0 <container> mv /tmp/aica-staging/artifact.zip /opt/liferay/deploy/
```

### 3. Benefits

- **Isolation**: Prevents Liferay from seeing partial or incomplete files.
- **Atomicity**: The `mv` command within the same filesystem is atomic in Linux.
- **Integrity**: Guarantees deterministic deployment success.

---## E2E Log Analysis Hardening

- **The Issue**: In `scripts/test-e2e-orchestrator.js`, the log analyzer `scripts/analyze-e2e-logs.js` is spawned without passing the log file location (`MS_LOG_FILE`) as an argument. This causes the analyzer to exit with code 1 immediately, marking even successful test runs as failed in the orchestrator log verification phase.
- **The Fix**: The orchestrator must explicitly pass `MS_LOG_FILE` to the spawned analyzer process.

---## LDM Fast Login Configuration

- **The Issue**: On fresh Liferay database setups (including LDM imports from clean seeds), logging in with `test@liferay.com` frequently redirects the browser to the "Terms of Use" page or "Password Reminder" page. These prevent page navigation to the dashboard and trigger 60-second locator timeouts in specs.
- **The Fix**: Add the `--fast-login` flag to the `ldm run` command in `scripts/run-e2e-ldm.sh`. This ensures that LDM configures Liferay to bypass the Terms of Use and Password Reminder screens.

---

## E2E Test Suite Connection & Import Reliability

- **The Issue**:
  1. On startup, Liferay Commerce takes 1-2 minutes to fully index and expose the default channel via its Headless APIs. If the E2E tests run immediately, the dropdown remains empty ("No channels found") and the "Generate" button stays disabled, timing out Playwright's click actions.
  2. The E2E import test `import.spec.js` was trying to click an "Import Dataset" button and interact with a non-existent import modal, causing immediate timeouts since the frontend actually handles imports via a hidden `#datasetImport` file input that stubs the operation.

- **The Fix**:
  1. Update `injectAndConnectApp` in both `dashboard.spec.js` and `import.spec.js` to wait for the Channel dropdown to be populated with channels (i.e. not containing "No channels found") using a retry loop that clicks "Retry Connection" or "Connected" every 5 seconds if still loading.
  2. Harden all "Generate" clicks in `dashboard.spec.js` by explicitly waiting for the button to become enabled.
  3. Refactor `import.spec.js` to upload the sample JSON directly to `input#datasetImport` and verify that the activity log logs the dataset import action.

---

## Unicode Host Parsing in Orchestration

- **The Issue**: In `scripts/run-e2e-ldm.sh`, resolving the hostname from `ldm list` via `cut -d'│'` failed in bash due to Unicode/locale constraints, resulting in `BASE_URL` being set to `https://` (which caused Playwright navigation errors and microservice configuration failures).
- **The Fix**: Update `scripts/run-e2e-ldm.sh` to extract the target URL's hostname using `grep -oE` instead of parsing with Unicode character delimiters.

---

## AICAConfiguration Validation (configStatus Field)

- **The Issue**: When the microservice starts up and attempts to sync API keys to Liferay, it performs a POST request to `/o/c/aicaconfigurations` via the SDK's `updateConfig` method. Since the SDK does not include the `configStatus` field in its payload, Liferay rejects the request with a `400 Bad Request` ("No value was provided for required object field "configStatus"").
- **The Fix**: Modify the `AICAConfiguration` object definition in `client-extensions/ai-commerce-accelerator-batch/batch/02-object-definition.batch-engine-data.json` to set `"required": false` for the `configStatus` field. This allows the configuration objects to be successfully created and updated without requiring the status field to be passed in every SDK request.

---

## E2E Commerce Auto-Provisioning

- **The Issue**: Fresh bootstrapped Liferay database environments do not contain any commerce catalogs or channels by default, causing the E2E Playwright tests to timeout while waiting for the dropdown elements to populate.
- **The Fix**: Update `playwright/tests/e2e/auth.setup.js` to automatically check if any channels exist. If the channel count is zero, the setup script will auto-provision a default catalog ("Master") and channel ("Web Store") using Liferay's Headless REST APIs before caching the authentication state.

---

## E2E Import Path Resolution

- **The Issue**: In `playwright/tests/e2e/import.spec.js`, resolving `resources/sample-import.json` using `path.resolve('resources/sample-import.json')` resolved relative to the current working directory of the process (which is `playwright/` when tests run), causing file-not-found errors during test execution.
- **The Fix**: Use `path.resolve(__dirname, '../../../resources/sample-import.json')` to resolve the path relative to the test file itself.

---

## Startup 404 Ignore Pattern in Log Analysis

- **The Issue**: During clean environment setup, the microservice attempts to poll and configure Liferay client extensions. Since Liferay starts up sequentially, early API calls to `/o/c/aicaconfigurations` result in a `404 Not Found` error. The forensic log analyzer incorrectly treats these expected transient startup delays as test failures.
- **The Fix**: Add an exception pattern `/aicaconfigurations.*(404|No service was found|Not Found)/i` to `IGNORE_PATTERNS` in `scripts/analyze-e2e-logs.js`.

---

## E2E Button Locator Strict Mode Violation

- **The Issue**: In `playwright/tests/e2e/dashboard.spec.js`, using `page.getByRole('button', { name: /Generat/i })` matches multiple elements (the collapsible accordion panel header "Data Generation Strategy" and the submit/generating buttons), causing strict mode violations in Playwright and failing the tests.
- **The Fix**: Use the highly specific CSS selector `button[type="submit"]` to uniquely target the inactive submit button, and assert on `'Cancel Generation'` and `'Generating...'` buttons individually when checking the active generating state.

---

## Page Management API Feature Flag (LPD-35443)

- **The Issue**: To manage pages, page templates, and page template sets via REST APIs using external reference codes, Liferay requires enabling the experimental/beta feature flag for LPD-35443.
- **The Fix**: Add `feature.flag.LPD-35443=true` to `configs/common/portal-ext.properties` and add `--feature LPD-35443` to the `ldm run` command in `scripts/run-e2e-ldm.sh` so it is automatically enabled on boot.

---

## SDK Page, Template, and Template Set Management Extensions

- **The Fix**: Implement `getSitePages`, `createSitePage`, `getSitePage`, `updateSitePage`, `deleteSitePage`, `patchSitePage` along with similar wrapper methods for `PageTemplate` and `PageTemplateSet` resources inside the `LiferayService` class, backed by the generated fluent client `headlessAdminSite` bindings.

---

## LDM URL Resolution and Protocol Support

- **The Issue**: When running E2E tests against an existing project instance (e.g. `fragments-test-env` running at `http://localhost:8080`), the test orchestrator extracts the domain name without its protocol or port and prepends `https://`. This leads to network timeouts because it attempts to query plain HTTP ports using HTTPS. Additionally, LDM list outputs can contain ANSI color escape sequences that contaminate the parsed URL.
- **The Fix**: Update `scripts/run-e2e-ldm.sh` to extract the full `TARGET_URL` (including protocol and port) from the output of `ldm list` using a strict URL character regex (to strip out trailing ANSI terminal color escape codes) and bind `BASE_URL` to it directly.

---

## LDM Reference Documentation

- **Documentation Repository**: [peterrichards-lr/liferay-docker-manager](https://github.com/peterrichards-lr/liferay-docker-manager)
- **Main Documentation Index**: [LDM README](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/README.md)
- **Environment Architecture & Routing Details**: [LDM Architecture](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/LDM_ARCHITECTURE.md)
- **Client Extension Routing & SSL Setup**: [LDM Networking & DNS Guide](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/guides/NETWORKING_DNS.md)
- **Local Replication of Cloud Environments**: [LDM PAAS Local Dev Guide](https://github.com/peterrichards-lr/liferay-docker-manager/blob/master/docs/guides/PAAS_LOCAL_DEV.md)

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
