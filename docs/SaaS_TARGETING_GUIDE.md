# How-To Guide: Populating Liferay Experience Cloud (SaaS) using AICA

This guide walk you through how to run the AI Commerce Accelerator (AICA) seeder locally on your laptop (or inside a local LDM container) and target a remote **Liferay Experience Cloud (SaaS)** environment to generate and populate a highly detailed, styled B2B commerce storefront.

Because AICA’s React Frontend proxies all API traffic server-to-server through our Node.js Microservice, **this flow completely bypasses browser CORS constraints**, making it extremely reliable for targeting remote cloud endpoints securely.

---

## Step 1: Configure the Remote Liferay SaaS Instance

Before connecting AICA, you must configure two standard settings inside your remote Liferay SaaS instance:

### 1. Enable the Page Management API Feature Flag (`LPD-35443`)

This flag is required to allow AICA to programmatically manage pages and layout templates via Headless APIs using External Reference Codes (ERCs).

1. Log into your Liferay SaaS instance as an Administrator.
2. Navigate to **Global Menu (top-right grid) ➔ Control Panel ➔ System Settings**.
3. Under the **Platform** category, click on **Feature Flags**.
4. In the **Beta** tab, locate **LPD-35443 (Page Management API)** and toggle it to **Active**.
5. Click **Save**.

### 2. Create an OAuth2 Headless Server Profile

Create the secure client credentials required by our SDK to authorize write requests.

1. Navigate to **Control Panel ➔ Security ➔ OAuth 2 Administration**.
2. Click the blue **Add (+)** button.
3. Input a name (e.g., `AICA Remote Seeder`) and select **Client Credentials** as the Flow.
4. Click **Save**.
5. Open the newly created application, copy the **Client ID** and **Client Secret**.
6. Go to the **Scopes** tab, select **Liferay.Headless.Site.everything** (and any required Commerce/Object scopes), and click **Save**.

---

## Step 2: Establish Bi-Directional Connectivity with `lfr-tunnel` (Crucial)

While AICA can make _outbound_ API calls from your laptop to Liferay SaaS to seed data natively, **Liferay SaaS cannot automatically communicate _inbound_ back to your local laptop** to fetch custom element Javascript (the React UI) or trigger server-to-server webhook actions (like Object triggers hitting the Node.js microservice).

To enable full bi-directional integration where Liferay SaaS can securely route traffic to your local development environment, you **MUST** utilize [`lfr-tunnel`](https://github.com/liferay/lfr-tunnel).

`lfr-tunnel` acts as a secure, public proxy that exposes your local `localhost:3000` (Frontend) and `localhost:3001` (Microservice) ports to public internet URLs (e.g., `https://my-aica-api.lfr.cool`) that Liferay SaaS can resolve.

### Activating the Tunnel

**If using LDM (Liferay Docker Manager):**
LDM natively orchestrates the tunnel for you. Ensure your LDM instance is actively running the tunnel container so that your local ports are securely exposed to the Liferay cloud environment.

**If running Standalone:**
You will need to manually download, install, and execute `lfr-tunnel` alongside your local Node.js servers. Please refer to the [official lfr-tunnel GitHub repository](https://github.com/liferay/lfr-tunnel) for installation instructions and tunneling commands.

---

## Step 3: Launch the Local AICA Seeder

You can run the seeder panel locally either via **Liferay Docker Manager (LDM)** or as a **Standalone Node.js application**.

### Option A: Launching via LDM (Recommended)

LDM is the fastest way to spin up the seeder UI and microservice containers in under 10 seconds:

```bash
# 1. Spin up the AICA Microservice and Frontend containers locally (using no local Liferay DB)
ldm launch aica --no-db --no-liferay

# 2. Open the local dashboard in your browser
open http://aica.local
```

### Option B: Launching Standalone (Zero-Docker)

If you don't have Docker installed, you can boot the Node.js services directly on your laptop:

```bash
# 1. Start the Microservice (in one terminal tab)
cd client-extensions/ai-commerce-accelerator-microservice
npm run dev

# 2. Start the React Frontend (in a second terminal tab)
cd ../ai-commerce-accelerator-frontend
npm run dev
```

---

## Step 4: Connect and Seed the SaaS Storefront

Once your local dashboard is loaded in your browser (`http://aica.local` or `http://localhost:3000`):

1. **Enter Connection Details:** In the **Connection & Authentication** card, enter:
   - **Liferay URL:** The full HTTPS URL of your SaaS instance (e.g., `https://my-saas-store.liferay.cloud`).
   - **Client ID:** Paste the Client ID from Step 1.
   - **Client Secret:** Paste the Client Secret from Step 1.
2. **Test Connection:** Click **Test Connection**.
   - AICA will securely authenticate, retrieve your SaaS instance's metadata, and light up the **Liferay Connected** indicator.
3. **Handle Empty Environments (Auto-Bootstrap):**
   - If your SaaS instance is completely fresh and has no existing catalogs or channels, AICA will display our **"No channels found"** warning.
   - Simply click the blue **`[ Auto-Create Channel ]`** button directly from the seeder panel.
   - AICA will programmatically provision a clean B2B channel (`AI Commerce Storefront`) on your SaaS instance, refresh the dropdown, and select it instantly!
4. **Choose Your Strategy:**
   - Configure your AI generation settings (Products count, geographic branding, specifications, and pricing rules).
5. **Fire the Seeder:** Click **`[ Generate Dataset ]`**.

---

## Step 5: Monitor and Verify

1. **Live Monitoring:** Watch the **Live Console** and **Progress Monitor** on your local dashboard. You will see real-time updates and WebSocket logs as the local Node.js seeder translates AI payloads and pushes them into your remote SaaS cloud instance.
2. **SaaS Verification:** Once completed, open your remote Liferay SaaS storefront. You will find:
   - A fully seeded product catalog with prices, specifications, and stock levels.
   - Fully constructed business accounts, addresses, and transaction histories.
   - The custom **Dashboard** and **Data Generator** pages, fully styled in Modern Fresh blue!
