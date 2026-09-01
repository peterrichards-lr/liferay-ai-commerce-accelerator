---
name: aica-developer
description: Guides and scripts for developing, testing, running E2E tests, linting, and using the CLI/utilities in the Liferay AI Commerce Accelerator monorepo.
---

# AICA Developer Skill & Runbook

This skill guides you through the standards, commands, and scripts required to develop, verify, configure, and seed datasets in the Liferay AI Commerce Accelerator (AICA) repository.

---

## 1. Environment & Monorepo Constraints

- **Yarn Monorepo Authority**: Yarn is the authoritative package manager for this workspace. **NEVER** commit a `package-lock.json` file to the repository.
- **Node.js Target Version**: The project is pinned to Node.js `v22.22.2` via `build.gradle` (`nodeVersion`). If you encounter environment-level node conflicts or ES module loading errors, clear the Gradle node cache:

  ```bash
  rm -rf .gradle/node
  ```

---

## 2. Core Scripts & Runbook

Always execute these scripts from the repository root:

### A. Headless CLI Client (`aica`)

The CLI client is a zero-dependency entrypoint ([aica-cli.cjs](../../../scripts/aica-cli.cjs)) used for seeding, deleting, exporting, and importing configurations.

- **Handshake Connection**:

  ```bash
  node scripts/aica-cli.cjs connect
  ```

- **Seed AI/Demo Dataset**:

  ```bash
  # Generate in demo mode (fast, utilizes static presets)
  node scripts/aica-cli.cjs generate --demo --products 10 --accounts 5 --orders 2

  # Generate in live AI mode
  node scripts/aica-cli.cjs generate --products 15 --accounts 5 --bulk-pricing
  ```

- **Delete Seeded Data**:

  ```bash
  node scripts/aica-cli.cjs delete --all
  ```

- **Export/Import Datasets**:

  ```bash
  # Export session data to a JSON package
  node scripts/aica-cli.cjs export <sessionId> output.json

  # Import and re-scaffold a dataset from a config JSON
  node scripts/aica-cli.cjs import resources/sample-import.json
  ```

### B. E2E Run Orchestrator (`run-e2e-ldm.sh`)

This script ([run-e2e-ldm.sh](../../../scripts/run-e2e-ldm.sh)) handles initializing LDM, starting Liferay DXP, deploying client extensions, and booting the microservice.

- **Non-Interactive Mandate**: When running this script programmatically, you **MUST** pass the `--ci` flag to bypass interactive developer prompts:

  ```bash
  bash scripts/run-e2e-ldm.sh -v -k --ci
  ```

### C. Snapshot Packaging (`ldm package`)

Packs the current Liferay Workspace assets and configuration into a portable snapshot `.ldmp` package. The standalone `scripts/package-ldmp.sh` wrapper was removed — invoke LDM directly:

```bash
ldm package aica-e2e --repo <your-github-repository> --host-name aica.demo --ssl -y
```

Release packages are built from scratch by [package-ldmp.yml](../../../.github/workflows/package-ldmp.yml) on every `v*` tag and attached to the GitHub Release, so there is never a need to keep a `.ldmp` in the working tree (`*.ldmp` is gitignored). AICA installs against vanilla DXP — the client extensions, OSGi modules, and site initializer create everything they need on setup — so a packaged `database.sql` is a demo-seeding convenience, not an install requirement.

### D. Preflight Network Probe (`preflight.mjs`)

Verifies that all required local environment ports are free and checks the health/availability of Liferay's REST APIs:

```bash
node scripts/preflight.mjs
```

### E. Secrets Sentinel (`detect-secrets.mjs`)

Executes locally in Huskies' pre-commit hooks to prevent leaking sensitive API keys (OpenAI, Google Gemini, Anthropic, etc.).

- **Bypassing false-positives**: If a mock token or test hash is flagged, append `// pragma: allowlist secret` at the end of the line, or add the substring / file glob pattern to [.gitleaksignore](../../../.gitleaksignore).

---

## 3. Standard Developer Commands

### Running Unit Tests

- **Microservice tests**: Run `yarn test` inside [client-extensions/ai-commerce-accelerator-microservice](../../../client-extensions/ai-commerce-accelerator-microservice).
- **Frontend tests**: Run `yarn test` inside [client-extensions/ai-commerce-accelerator-frontend](../../../client-extensions/ai-commerce-accelerator-frontend).

  > The SDK (`liferay-accelerator-sdk`) was extracted into its own repository (#198) and is no longer part of this monorepo's workspaces.

### Running Playwright E2E/Smoke Tests

- **Smoke Tests**: `yarn smoke` (or `npx playwright test --config playwright/playwright.config.js`).
- **Full verification**: `yarn verification`.

### Linting and Checks

- **Code Linting**: `yarn lint` at root.
- **Client Extension Validation**: `yarn lint:cx` (runs [validate-cx.js](../../../scripts/validate-cx.js) to check schema alignment with `client-extension.yaml`).
- **Markdown Linting**: `yarn lint:md`.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-01_ | _Last Reviewed: 2026-09-01_
