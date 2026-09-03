# Local Execution & Operations Guide (Outside of LDM)

This runbook guides you through executing the **Liferay AI Commerce Accelerator (AICA)** locally against an existing or restored Liferay DXP environment without using Liferay Docker Manager (LDM) or downloading `.ldmp` packages.

---

## 1. Architecture Overview

When running outside of LDM, the system operates with three distinct components:

```text
┌─────────────────────────┐          REST & Batch APIs          ┌─────────────────────────┐
│       Liferay DXP       │ ◄────────────────────────────────── │    AICA Microservice    │
│  (Tomcat Bundle/Docker) │                                     │  (Node.js Daemon :3001) │
│       Port :8080        │ ──────────────────────────────────► │                         │
└─────────────────────────┘             WebSockets              └────────────┬────────────┘
             ▲                                                               │
             │                 Client Extensions (Batch / UI)                │
             └───────────────────────────────────────────────────────────────┘
                                             ▲
                                             │ Control & Seeding
                                ┌────────────┴────────────┐
                                │ CLI / Web Control Panel │
                                │   (Port 3001 / CLI)     │
                                └─────────────────────────┘
```

- **Target DXP Instance** (Port `8080`): The running Liferay portal hosting commerce catalogs, channels, and Object definitions.
- **AICA Microservice** (Port `3001`): The Node.js orchestrator that connects to DXP via REST APIs, handles AI generation, and coordinates asynchronous batch engine jobs.
- **Client Extensions**: The data definitions (`batch`), management UI (`configuration`), and storefront widgets (`frontend` and `site-initializer`) deployed to DXP.
- **AICA CLI & Control Center**: Zero-dependency scripts to trigger seeding, inspect connection status, or manage sessions.

---

## 2. Prerequisites

- **Java JDK**: Version 11 or 21 (LTS).
- **Node.js**: `v22.22.2` (pinned via `build.gradle`).
- **Yarn**: `v1.22+`.
- **Liferay Blade CLI** or the bundled `./gradlew` wrapper.

---

## 3. Step 1: Prepare the Target Liferay DXP Instance

### Required Feature Flag

AICA requires the **Page Management API** feature flag to automatically scaffold demo pages and bind templates:

Ensure `portal-ext.properties` contains:

```properties
feature.flag.LPD-35443=true
```

For a smooth local experience (bypassing password reset prompts and setup wizards), you can use the repository defaults located in [`configs/common/portal-ext.properties`](file:///Users/peterrichards/dev/repos/liferay-ai-commerce-accelerator/configs/common/portal-ext.properties):

```properties
setup.wizard.enabled=false
passwords.default.policy.change.required=false
terms.of.use.required=false
company.security.strangers.verify=false
users.reminder.queries.enabled=false
default.admin.password=test
feature.flag.LPD-35443=true
```

### Starting Liferay DXP Locally

- **Using the local Tomcat bundle (`bundles/`)**:

  ```bash
  ./bundles/tomcat/bin/catalina.sh run
  ```

  _(Or run `blade server run` from the project root)._

- **Using standalone Docker (without LDM)**:

  ```bash
  docker run -it -m 8g -p 8080:8080 \
    -e LIFERAY_SETUP_PERIOD_WIZARD_PERIOD_ENABLED=false \
    -e LIFERAY_PASSWORDS_PERIOD_DEFAULT_PERIOD_POLICY_PERIOD_CHANGE_PERIOD_REQUIRED=false \
    -e LIFERAY_DEFAULT_PERIOD_ADMIN_PERIOD_PASSWORD=test \
    -e LIFERAY_FEATURE_PERIOD_FLAG_PERIOD__UPPERCASEL__UPPERCASEP__UPPERCASED__MINUS__35443=true \
    -v "$(pwd)/bundles/osgi/client-extensions:/opt/liferay/osgi/client-extensions" \
    liferay/dxp:2026.q1.7-lts
  ```

---

## 4. Step 2: Build & Deploy Client Extensions to DXP

All client extensions (including the `ai-commerce-accelerator-batch` extension that defines the Liferay Objects and prompts) must be deployed to the running Liferay instance:

```bash
./gradlew clean deploy
```

_(Or `blade gw clean deploy`)._

This command automatically:

1. Executes `generateBatchFiles` to build minified schemas and prompt payloads into `client-extensions/ai-commerce-accelerator-batch/batch/`.
2. Compiles frontend and configuration assets.
3. Packages each client extension into `.zip` bundles and deploys them to `bundles/osgi/client-extensions/`.

---

## 5. Step 3: Configure Environment & Launch the Microservice

### Configure `.env`

Create or update [`.env`](file:///Users/peterrichards/dev/repos/liferay-ai-commerce-accelerator/.env) in the project root to target your DXP instance:

```env
# Target DXP Endpoint
LIFERAY_API_URL=http://localhost:8080
LIFERAY_URL=http://localhost:8080
COM_LIFERAY_LXC_DXP_MAIN_DOMAIN=localhost:8080
COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL=http

# Administrative Basic Authentication
LIFERAY_API_USERNAME=test@liferay.com
LIFERAY_API_PASSWORD=test

# AI Provider API Key (OpenAI, Gemini, or Anthropic)
AI_API_KEY=sk-...
```

### Launch the Microservice Daemon

From the project root, you can start the service using the interactive launcher:

```bash
./start.sh
```

Select **[1] Start & Open Local Dashboard UI** to boot the microservice on `http://localhost:3001` and automatically open your browser.

Alternatively, start the server directly:

```bash
cd client-extensions/ai-commerce-accelerator-microservice
yarn start
```

---

## 6. Step 4: Execute Data Generation

### Verify Connection

Test the handshake and taxonomy inspection:

```bash
node scripts/aica-cli.cjs connect
```

### Option A: Headless Seeding via CLI

Generate 30 products, accounts, and historical orders:

```bash
node scripts/aica-cli.cjs generate \
  --products 30 \
  --accounts 4 \
  --orders 10 \
  --bulk-pricing \
  --tier-pricing \
  --specifications
```

_(To run an offline mock test without consuming live AI tokens, add the `--demo` flag)._

### Option B: Interactive UI Generation

1. Navigate to `http://localhost:3001` in your browser.
2. In the **Data Generator** form:
   - **Brand / Context**:

     ```text
     Solara Moto Gear — Premium motorcycle luggage systems, aluminum side panniers, top cases, bike-specific mounting hardware, and technical riding accessories.
     ```

   - **Product Count**: `30`
   - **Account Count**: `4`
   - **Order Count**: `10`
3. If using custom persona and ordering rules, update the prompt templates in the **Configuration Panel**:
   - `ai-prompt-product`: Luggage lines, bike-specific mounting kits, and specifications (FITMENT, CAPACITY, INSTALL_TIME, MATERIAL).
   - `ai-prompt-account`: B2C personas ("Adventure Alex", "Touring Tina") and B2B dealers ("MotoPro Outfitters Inc.", "Apex EuroDistributors Ltd.").
   - `ai-prompt-order`: B2B cross-sell rule (MotoPro orders restricted to TR500 luggage).
4. Click **Generate Data**. The progress bars track real-time batch creation, option linking, and taxonomy grounding via WebSockets.

---

## 7. Step 5: Teardown & Reset Operations

To delete all generated products, accounts, catalogs, and reset the local microservice session state:

```bash
node scripts/aica-cli.cjs delete --all
```

_(Or select **[4] Clean / Teardown All Generated Data** in `./start.sh`)._

---

## 8. Operational Troubleshooting

### 401 Account Lockout Loop

Liferay locks out accounts after 5 failed login attempts during rapid polling. If `test@liferay.com` becomes locked, unlock the user in your database:

```sql
UPDATE user_ SET lockout = false, lockoutDate = null, failedLoginAttempts = 0 WHERE emailaddress = 'test@liferay.com';
```

### Search Indexing Latency

If newly created products or Object configurations do not immediately appear in searches or dropdowns, trigger a search reindex:

```bash
node scripts/aica-cli.cjs reindex
```

_(Or in DXP: **Control Panel -> Search -> Index Actions -> Reindex All**)._

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-03_ | _Last Reviewed: 2026-09-03_
