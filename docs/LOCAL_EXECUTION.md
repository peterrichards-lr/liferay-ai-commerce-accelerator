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

#### Starting via Gradle, so OAuth credentials are discovered

Prefer the Gradle task when the client extensions are deployed to a local
bundle:

```bash
./gradlew :client-extensions:ai-commerce-accelerator-microservice:packageRunStart
```

Use `packageRunDebug` instead to attach a debugger.

The `packageRun*` tasks are not merely a wrapper around `yarn start`. The
Liferay Workspace plugin sets `LIFERAY_ROUTES_CLIENT_EXTENSION` and
`LIFERAY_ROUTES_DXP` on them, pointing at the configuration Liferay writes when
a client extension is deployed:

```text
bundles/routes/default/ai-commerce-accelerator-microservice
bundles/routes/default/dxp
```

That directory holds the OAuth client id and secret, so the microservice
authenticates without any credentials in `.env`. Starting with `yarn start` or
`node server.cjs` bypasses the injection, leaving nothing for OAuth discovery
to read — which presents as an authentication failure that looks like a wrong
client secret.

If you must start it outside Gradle, either set those two variables yourself
(see `.env.example`) or set `LIFERAY_AUTH_METHOD=basic` to use
`LIFERAY_API_USERNAME` and `LIFERAY_API_PASSWORD` instead.

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
   - **Brand / Context**: Provide the name and domain description of the catalog to seed, e.g.:

     ```text
     Acme Industrial Supplies — Commercial power tools, heavy-duty safety gear, and industrial shop equipment.
     ```

   - **Product Count**: Target product volume (e.g. `30`).
   - **Account Count**: Target account volume for B2B/B2C entities (e.g. `4`).
   - **Order Count**: Target historical order volume (e.g. `10`).
3. If using custom persona and ordering rules, customize the prompt templates in the **Configuration Panel**:
   - `ai-prompt-product`: Define category lines, option matrices (colors, sizes), and key-value technical specifications (e.g. MATERIAL, CAPACITY, COMPATIBILITY).
   - `ai-prompt-account`: Define customer persona types, regional distribution, and B2B dealer profiles with contact roles.
   - `ai-prompt-order`: Define purchase behaviors, date distribution ranges, and targeted cross-sell / upsell purchasing patterns across accounts.
4. Click **Generate Data**. The progress bars track real-time batch creation, option linking, and taxonomy grounding via WebSockets.

---

## 7. Targeting Remote Liferay Instances (PaaS / SaaS / Cloud Environments)

When populating commerce data for a remote Liferay PaaS (LCP) or Experience Cloud environment, you run the AICA microservice and CLI locally while executing outbound API requests directly against the remote portal URL. Because requests originate server-to-server from the Node.js daemon, **browser CORS constraints are completely bypassed**.

### Remote Instance Prerequisites

1. **Enable Feature Flag**: In your remote Liferay instance, go to **Control Panel -> System Settings -> Platform -> Feature Flags** and enable `LPD-35443` (Page Management API).
2. **Deploy Object Definitions**: Ensure the `ai-commerce-accelerator-batch` client extension is deployed to the remote instance so the required Liferay Object definitions (`c_aicaconfiguration`, etc.) are active.
3. **Authentication Profile**:
   Create an OAuth2 Headless Server profile in the remote Liferay Cloud portal:
   - Go to **Global Menu ➔ Control Panel ➔ Security ➔ OAuth 2 Administration**.
   - Click the **Add (+)** button.
   - Configure:
     - **Application Name**: `AICA Microservice Remote Seeder`
     - **Client Profile**: `Headless Server`
     - **Allowed Grant Types**: Check `Client Credentials`
   - Click **Save**, then copy the generated **Client ID** and **Client Secret**.
   - Open the **Scopes** tab and enable the following scopes:
     - `Liferay.Headless.Commerce.Admin.Catalog.everything`
     - `Liferay.Headless.Commerce.Admin.Channel.everything`
     - `Liferay.Headless.Commerce.Admin.Inventory.everything`
     - `Liferay.Headless.Commerce.Admin.Order.everything`
     - `Liferay.Headless.Commerce.Admin.Pricing.everything`
     - `Liferay.Headless.Delivery.everything`
     - `Liferay.Headless.Admin.User.everything`
     - `Liferay.Headless.Admin.Address.everything`
     - `Liferay.Headless.Batch.Engine.everything`
     - `c_aicaconfiguration.everything`
   - Click **Save**.

### Configure Remote `.env`

Point your local [`.env`](file:///Users/peterrichards/dev/repos/liferay-ai-commerce-accelerator/.env) to the remote PaaS hostname:

```env
# Remote Liferay PaaS / Cloud URL
LIFERAY_API_URL=https://webserver-myproject-prd.lfr.cloud
LIFERAY_URL=https://webserver-myproject-prd.lfr.cloud
COM_LIFERAY_LXC_DXP_MAIN_DOMAIN=webserver-myproject-prd.lfr.cloud
COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL=https

# Basic Auth Credentials (Optional Fallback)
LIFERAY_API_USERNAME=admin@example.com
LIFERAY_API_PASSWORD=your-remote-password

# OAuth2 Client Credentials Flow (Recommended)
LIFERAY_OAUTH_CLIENT_ID=your-client-id
LIFERAY_OAUTH_CLIENT_SECRET=your-client-secret

# AI Provider Key
AI_API_KEY=sk-...
```

### Execute Against Remote Instance

#### Option A: Interactive Local UI (Targeting Remote Cloud)

1. Launch the local microservice via `./start.sh` (Option **[1]**) or `yarn start`.
2. Open `http://localhost:3001` in your browser.
3. In the **Connection & Authentication** card, enter:
   - **Liferay URL**: `https://webserver-myproject-prd.lfr.cloud`
   - **Microservice URL**: `http://localhost:3001`
   - **Client ID**: Your remote OAuth2 Client ID
   - **Client Secret**: Your remote OAuth2 Client Secret
4. Click **Test Connection** / **Connect**. Once the status indicator turns green, use the **Data Generator** form to trigger seeding. The local microservice executes all requests server-to-server directly into your remote PaaS instance.

#### Option B: Headless CLI

1. **Test Remote Handshake & Channel Inspection**:

   ```bash
   node scripts/aica-cli.cjs connect
   ```

   AICA will query the remote instance's live channels, sites, and currency settings.

2. **Trigger Seeding**:

   ```bash
   node scripts/aica-cli.cjs generate --products 30 --accounts 4 --orders 10
   ```

   _(For full bi-directional communication with custom element microfrontends or webhook callbacks on remote SaaS instances, see [`docs/SaaS_TARGETING_GUIDE.md`](file:///Users/peterrichards/dev/repos/liferay-ai-commerce-accelerator/docs/SaaS_TARGETING_GUIDE.md))._

---

## 8. Step 5: Teardown & Reset Operations

To delete all generated products, accounts, catalogs, and reset the local microservice session state:

```bash
node scripts/aica-cli.cjs delete --all
```

_(Or select **[4] Clean / Teardown All Generated Data** in `./start.sh`)._

---

## 9. Operational Troubleshooting

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

_Last Updated: 2026-09-04_ | _Last Reviewed: 2026-09-04_
