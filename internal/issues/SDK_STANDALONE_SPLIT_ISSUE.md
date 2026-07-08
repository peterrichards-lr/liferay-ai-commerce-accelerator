# Epic: Extract Liferay Accelerator SDK into a Standalone Repository

**Title**: `[SDK Split] Extract @liferay/accelerator-sdk into a standalone repository and publish to npm registry`  
**Type**: Infrastructure / Refactoring  
**Labels**: `epic`, `infrastructure`

---

## Context & Objectives

As AICA evolves, the `@liferay/accelerator-sdk` has become a hardened, robust integration wrapper for Liferay DXP (REST, GraphQL, Vulcan OpenAPI contract validation, resilience, and retry handlers).

To enable reusing this SDK across other Liferay accelerator projects (such as CMS, Forms, or generic Portal integrations) and to develop AI-agent-focused interfaces (like MCP servers and JSON-RPC sidecars) safely without affecting the commerce accelerator monorepo, we will extract the SDK into its own standalone repository.

---

## High-Level Extraction Strategy

1.  **Isolate & Initialize**: Create a standalone Git repository containing only the SDK codebase, its history (if preserved), and utility scripts.
2.  **Publishing & Registry Integration**: Configure CI workflows to publish the package to a registry (NPM or GitHub Packages) as `@liferay/accelerator-sdk`.
3.  **Monorepo Deprecation**: Remove the local SDK folder from the commerce accelerator monorepo, update workspaces, and import it as a standard package.

---

## Sub-Issues Breakdown

### Sub-Issue 1: Initialize Standalone SDK Repository

- **Goal**: Setup the new Git repository structure and verify local development.
- **Implementation Steps**:
  1. Initialize a new Git repository `liferay-accelerator-sdk`.
  2. Copy the contents of `client-extensions/liferay-accelerator-sdk/` to the root of the new repository.
  3. Configure `.gitignore` (ignoring `.env`, `node_modules`, `coverage/`, etc.), `LICENSE`, and `README.md`.
  4. Run `yarn install` and verify that `npm run test` executes successfully.

### Sub-Issue 2: Setup CI/CD Workflows & Registry Publishing

- **Goal**: Automate testing, linting, and semantic version publishing.
- **Implementation Steps**:
  1. Create a GitHub Actions workflow `.github/workflows/ci.yml` that runs on every Pull Request to lint code, run tests, and check contract compatibility.
  2. Create `.github/workflows/release.yml` that triggers on tags/releases to publish the package to the target registry (NPM or GitHub Packages) using `npm publish`.
  3. Configure workspace repository URLs in `package.json`.

### Sub-Issue 3: Update Commerce Accelerator Monorepo to Use Published SDK

- **Goal**: Clean up the monorepo and transition to the externalized package.
- **Implementation Steps**:
  1. Remove the folder `client-extensions/liferay-accelerator-sdk/` from the `liferay-ai-commerce-accelerator` repository.
  2. Remove `"client-extensions/liferay-accelerator-sdk"` from the workspaces array in root `package.json`.
  3. Run `yarn add @liferay/accelerator-sdk` at the root of the monorepo (or within workspace package files) to pull the published SDK from the registry.
  4. Run `bash scripts/run-e2e-ldm.sh -v -k --ci` to confirm the monorepo works flawlessly with the externalized dependency.

### Sub-Issue 4: Implement Standalone MCP Server & CLI Tooling (AI Gateway Phase)

- **Goal**: Wrap the SDK as a standalone Model Context Protocol (MCP) server for LLMs.
- **Implementation Steps**:
  1. Install `@modelcontextprotocol/sdk` as a dependency in the new SDK repository.
  2. Create `bin/mcp-server.cjs` exposing the SDK's REST and GraphQL methods as MCP tools (`liferay_get_products`, `liferay_get_accounts`, etc.).
  3. Register a command-line launcher bin script in `package.json` to allow starting the server instantly with `npx @liferay/accelerator-sdk mcp`.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
