# Quick Start & Installation Guide

This guide covers the deployment, configuration, and execution of the **Liferay AI Commerce Accelerator (AICA)**.

---

## 🎭 The Sales Engineering Demo

AICA is designed specifically as a Sales Engineering (SE) demonstration tool. To support diverse demonstration requirements, it is built to be turnkey and highly portable.

If you are an SE looking to run the AICA demo immediately without compiling code, the **Liferay Docker Manager (LDM)** remote import pipeline is the fastest route.

### 1. Install LDM

If you do not have LDM installed, install the standalone binary:

```bash
# macOS (Apple Silicon)
sudo curl -L https://github.com/peterrichards-lr/liferay-docker-manager/releases/latest/download/ldm-macos-arm64 -o /usr/local/bin/ldm && sudo chmod +x /usr/local/bin/ldm
```

_(For Windows, Linux, or Intel Macs, refer to the [Official LDM Repository](https://github.com/peterrichards-lr/liferay-docker-manager))._

### 2. Import & Launch AICA

Run the following command to automatically download the latest release package and launch the DXP container stack:

```bash
ldm quickstart aica
```

LDM will boot the database, Liferay, and the Microservice. Once booted, the Site Initializer automatically builds your demo storefront.

The release package ships the client extensions, OSGi modules, and site initializer — **not** a database dump. AICA installs against vanilla DXP and every component creates what it needs on setup, so the package stays around 12 MB rather than 1 GB and never carries stale pre-seeded data. Populate the catalog yourself once the stack is up, which takes about two minutes:

```bash
aica generate --demo --products 10 --accounts 10 --orders 50
```

Or use the **AI Data Generator** screen in Liferay, described in [Features & Capabilities](./FEATURES.md).

---

## 🛠️ Developer Setup (Manual Build)

If you are contributing to AICA or want to run it from source, follow these steps.

### Prerequisites

- **Node.js**: v22+ (LTS recommended)
- **Liferay DXP/Portal**: 7.4+
- **Yarn**: 1.22+
- **Liferay Blade CLI**

**Required Feature Flag:**
To support automated scaffolding of site pages and template linking, you must enable **LPD-35443 (Page Management API)** in Liferay.
_(Note: If using LDM, this is handled automatically)._

### 1. Workspace Setup

Run from the root directory to install all dependencies:

```bash
npm install
```

### 2. Full Deployment to Liferay

To perform a full, clean deployment of all client extensions (including the `ai-commerce-accelerator-batch` extension required for data definitions):

```bash
blade gw clean deploy
```

### 3. Subsystem Development

For active development, you can run the microservice and frontend independently.

**🚀 Microservice:**

```bash
cd client-extensions/ai-commerce-accelerator-microservice
npm start
```

_The service will start on `http://localhost:3001`._

**🖥️ Frontend:**

```bash
cd client-extensions/ai-commerce-accelerator-frontend
npm run dev
```

_The UI will be available at `http://localhost:5173`._

---

## 🧪 Testing & Verification

### Automated LDM E2E Verification (Recommended)

To verify the entire stack (Microservice, Frontend, and Liferay Integration) in a clean environment, use the provided orchestrator:

```bash
LIFERAY_API_PASSWORD=test LIFERAY_API_USERNAME=test@liferay.com bash scripts/run-e2e-ldm.sh -v -k
```

### Unit Tests & Quality Gates

You can run tests for all components from the root:

```bash
npm test
```

The project implements an enforced testing strategy. The `deploy` task is dependent on `testAllCX`, meaning **client extensions will only be deployed if all tests pass**. We target a minimum of **45% statement coverage** across the SDK and microservice codebases (`vitest.config.mjs`).

---

## 📦 Packaging (.ldmp)

To package the AICA suite into a single `.ldmp` bundle for distribution, use LDM's own packaging command directly (the standalone `scripts/package-ldmp.sh` wrapper was removed — see `.github/workflows/package-ldmp.yml` for the CI invocation):

```bash
# Stop the stack, then empty Liferay's data and state volumes
ldm stop -p aica-e2e -y
docker run --rm -v aica-e2e-data:/v alpine sh -c 'rm -rf /v/..?* /v/.[!.]* /v/* 2>/dev/null; true'
docker run --rm -v aica-e2e-state:/v alpine sh -c 'rm -rf /v/..?* /v/.[!.]* /v/* 2>/dev/null; true'
rm -rf aica-e2e/data aica-e2e/osgi/state

# Snapshot, then package that snapshot
ldm snapshot -p aica-e2e -y
ldm package aica-e2e --use-latest --repo <your-github-repository> -y
```

This outputs a `.ldmp` bundle and a SHA-256 checksum file, around 2.3 MB. See `.github/workflows/package-ldmp.yml` for the exact release invocation.

Three things about this sequence are not obvious, and each cost a failed release to learn:

- **The database is excluded by stopping the stack, not by a flag.** LDM decides whether to bundle a dump purely by probing whether the database container is running. `ldm snapshot --files-only` is accepted by the CLI but read by no code path, so it has no effect.
- **Emptying the volumes matters as much as stopping.** Snapshotting dehydrates the `data` and `state` Docker volumes back onto the host and archives them, which keeps the bundle near 1 GB even with no database. Empty them through a throwaway mount rather than `docker volume rm`, which refuses while a stopped container still references them.
- **`--host-name` and `--ssl` on `ldm package` do nothing.** `cmd_package` takes no such parameters. The published values come from the snapshot's `meta`, which the release workflow rewrites directly. Left alone, the package inherits whatever the build environment used.
- **The workflow strips pinned client-extension routes.** The snapshot captures the Liferay service's environment into `custom_env`, which _is_ propagated to consumers on import — including `LIFERAY_ROUTES_CLIENT_EXTENSION_..._MICROSERVICE` pointing at the build environment's own container hostname, which resolves nowhere else. Dropping it lets Liferay auto-register the route for the consumer's project when the client extension is deployed, which is the same reason `serviceAddress` is never hand-edited in `client-extension.yaml`.
- **The workflow also declares `client_extensions` itself.** LDM derives `includes_client_extensions` from `cx/`, `deploy/` and the build directory, but `client_extensions` from the build directory alone — so a package can truthfully say it includes extensions and then list none. The workflow reads the list out of `files.tar.gz` and writes it, and verification fails the release if the declared list and the shipped archives disagree.

To capture a specific local state including your PostgreSQL data — useful for handing an environment to a colleague — package while the stack is running and skip the volume cleanup. That is deliberately not what ships in releases.

---

## ⚠️ Known Issues & Troubleshooting

### Node.js Versioning Constraint

**Liferay's internal build process enforces Node.js 22.22.2** (pinned via `nodeVersion` in `build.gradle`). Attempts to override this with newer Node.js versions via Gradle properties conflict with Liferay's build requirements. The microservice itself, running in Docker, is immune to this and uses whatever modern Node.js version its own Dockerfile specifies.

### 401 Unauthorized Loop (Account Lockout)

Liferay DXP locks out user accounts after **5 failed login attempts**. During automated E2E testing, early connection attempts before authentication modules are fully active can lock out the admin user.
_Fix_: The E2E Test Orchestrator auto-recovers. To fix manually, run this SQL query on your database:

```sql
UPDATE user_ SET lockout = false, lockoutDate = null, failedLoginAttempts = 0 WHERE emailaddress = 'test@liferay.com';
```

### Harmless `OptimisticLockException` Logs

During initial boot, you may see `OptimisticLockException` for `UserImpl`. This is caused by parallel connections competing to increment the `failedLoginAttempts` counter. **This exception is entirely harmless and expected.**

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-03_ | _Last Reviewed: 2026-09-03_
