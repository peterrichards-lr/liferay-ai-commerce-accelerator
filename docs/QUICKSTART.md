# Quick Start & Installation Guide

This guide covers the deployment, configuration, and execution of the **Liferay AI Commerce Accelerator (AICA)**.

---

## 🎭 The 1-Minute Sales Engineering Demo

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

Run the following command to automatically download the latest pre-compiled database snapshot and launch the DXP container stack:

```bash
ldm quickstart aica
```

That's it! LDM will boot the database, Liferay, and the Microservice. Once booted, the Site Initializer will automatically build your demo storefront.

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

The project implements an enforced testing strategy. The `deploy` task is dependent on `testAllCX`, meaning **client extensions will only be deployed if all tests pass**. We target a minimum of **40% statement coverage** across the SDK and microservice codebases.

---

## 📦 Packaging (.ldmp)

To package the entire AICA suite—including your active PostgreSQL database state, dynamic document uploads, and configuration files—into a single `.ldmp` bundle for distribution:

```bash
./scripts/package-ldmp.sh
```

This outputs `liferay-ai-commerce-accelerator.ldmp` and a SHA-256 checksum file.

---

## ⚠️ Known Issues & Troubleshooting

### Node.js Versioning Constraint

**Liferay's internal build process enforces Node.js 20.12.2**. Attempts to override this with newer Node.js versions via Gradle properties conflict with Liferay's build requirements. We utilize Vite `^8.0.10` and `@vitejs/plugin-react` `^6.0.1` to maintain compatibility with this older build environment. The microservice itself, running in Docker, is immune to this and uses modern Node.js.

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

_Last Updated: 2026-07-07_ | _Last Reviewed: 2026-07-07_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
