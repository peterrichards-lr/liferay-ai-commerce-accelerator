# Liferay AI Commerce Accelerator

Empowering Liferay Commerce with high-integrity, AI-orchestrated data.

[![CI](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/actions/workflows/ci.yml/badge.svg)](https://github.com/peterrichards-lr/liferay-ai-commerce-accelerator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The **Liferay AI Commerce Accelerator** is a production-ready suite of client extensions designed to rapidly generate and deploy sophisticated commerce data into Liferay DXP using generative AI. It eliminates the manual effort of populating catalogs, accounts, and orders, allowing teams to focus on building and testing features.

## 🖼️ User Interface & Visual Experience

AICA features a beautifully designed, modern, and data-dense user interface inside Liferay DXP. Below are visual previews of the client extension views:

### 1. AI Data Generator (Populating the Catalog)

_Seed comprehensive commerce catalogs, pricing structures, and media assets in under 2 minutes._
![AI Data Generator](./docs/images/data-generator.png)

### 2. Live Monitoring & Session Administration Dashboard

_Monitor active generation steps in real-time via WebSockets with detailed progress gauges, stats hydration, and logs analysis._
![Monitoring Dashboard](./docs/images/dashboard-admin.png)

### 3. Client Extension System Configuration

_Configure AI provider keys, API endpoints, and DXP connectivity parameters dynamically directly in Liferay's Control Panel._
![System Configuration](./docs/images/configuration-panel.png)

## 🚀 Quick Navigation

- **[Setup & Deployment](./docs/SETUP.md)**: How to get the accelerator running in your environment.
- **[Architectural Overview](./docs/ARCHITECTURE.md)**: Deep dive into the stateful workflow engine and system map.
- **[Features & Capabilities](./docs/FEATURES.md)**: Details on AI generation, real-time monitoring, and visual assets.
- **[Workflow Diagrams](./docs/workflow-diagrams.md)**: Visual guides to the data creation and deletion processes.
- **[E2E Verification & Test Report](./docs/TEST_REPORT.md)**: Full verification scorecard of the system.

## 💻 Native CLI Command Suite (`aica`)

AICA features a zero-dependency, native headless command line interface **`aica`** (linked via NPM binaries) to automate catalog seeding, teardowns, and dataset migrations directly from your scripts or CI/CD pipelines:

```bash
# Verify connection to local microservice and handshake with DXP
aica connect

# Seed a demo catalog of 10 Products, 10 B2B Accounts, and 50 Orders in <2 minutes!
aica generate --demo --products 10 --accounts 10 --orders 50

# Retrieve and pretty-print the current active configuration parameters
aica config get

# Set a single configuration parameter dynamically
aica config set --key liferayUrl --value "https://my-custom-dxp.com"

# Export a completed generation dataset to JSON for portability
aica export AICA-SESSION-12345 ./my-saved-dataset.json

# Import and re-scaffold a saved dataset on a new Liferay DXP instance in <1 minute!
aica import ./my-saved-dataset.json

# Wipe all generated commerce entities globally, leaving Liferay perfectly clean
aica delete --all
```

## 🧪 Verification

The accelerator includes a comprehensive "one command" verification suite using **Liferay Docker Manager (LDM)**. This ensures that changes can be tested against a clean, production-parity environment automatically.

```bash
./scripts/run-e2e-ldm.sh
```

### Advanced Usage

You can customize the orchestrator using the following flags and environment variables:

- `-p <project_name>` / `--project`: Target an **existing** LDM project instead of creating a fresh ephemeral one. (e.g. `./scripts/run-e2e-ldm.sh -p fragments-test`)
- `-k` / `--keep`: Prevents the automated `ldm rm --delete` cleanup at the end of the script. Useful for logging in and debugging a failed test run.
- `-v` / `--verbose`: Prints all realized `ldm`, `gradlew`, and `yarn` commands before they execute.
- `LIFERAY_USER` / `LIFERAY_PASSWORD`: Override the default authentication credentials used by the Playwright tests.

This orchestrator will:

1. Verify system dependencies (LDM >= 2.5.4, Docker, mkcert).
2. Start a clean Liferay environment matched to `gradle.properties`.
3. Build and deploy all Client Extensions.
4. Execute Playwright E2E tests across multiple responsive states (Desktop, Mobile, Tablet).
5. Generate visual snapshots in `test-results/` for manual verification.
6. Automatically teardown the environment.

## ✨ Core Pillars

### 🧠 Intelligent Orchestration

A stateful, resilient microservice manages complex entity dependencies and Liferay batch processes, ensuring 100% data integrity even across server restarts.

### 🎨 Premium UI/UX

A modern, data-dense dashboard provides real-time progress tracking via WebSockets, featuring a striking overall progress gauge and system health monitoring.

### 🌐 Provider Agnostic

Switch between leading AI providers like **OpenAI**, **Google Gemini**, and **Anthropic** with zero code changes. Support for specialized media providers like **Nano Banana** ensures high-quality product visuals.

### 🧪 Zero-Cost Mock AI Sandbox

Develop and run complete, data-rich E2E generation workflows at **exactly $0.00 cost** and zero network dependencies! Simply configure `GEMINI_API_KEY="mock-sandbox"` to trigger our schema-aware payload simulator. It generates fully compliant mock data arrays matching Liferay Commerce schemas on-the-fly.

### 🛡️ Pre-flight Token Safety Guardrail

Never worry about accidental billing leaks or API quota drains. AICA integrates a local, zero-dependency token count estimator. It analyzes prompt and template sizes before they reach the wire, force-aborting oversized requests (>15,000 tokens) unless explicitly bypassed via `ALLOW_LARGE_PROMPTS=true`!

### 🔒 Secure & Scalable

Hardened with strictly scoped External Reference Codes (AICA-\*) and comprehensive security headers. Built on a modular client extension architecture for seamless integration with Liferay Cloud or self-hosted environments.

---

_Part of the Liferay AI Commerce Ecosystem._

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_
