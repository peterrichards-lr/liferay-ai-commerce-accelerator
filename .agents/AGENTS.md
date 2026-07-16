# Project automation rules

All development, issue backlog prioritization, release workflows, and deployments MUST strictly follow the specifications defined in the [Automation Playbook](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/PLAYBOOK.md).

## Definition of Done (E2E Verification)

Before any feature, bugfix, or issue can be considered "code complete", the agent MUST run the local E2E Playwright test suite (`bash scripts/run-e2e-ldm.sh -v -k --ci`) and verify that all tests pass against a real Liferay DXP container. Do not declare a task finished or push final PRs until this E2E verification succeeds.

## Client Extension Routing Rules

When modifying `client-extension.yaml` files, **NEVER change or remove `.serviceAddress: localhost:3001` or `.serviceScheme`** manually to fix Docker or LDM routing issues. Liferay automatically updates the shared routes context with the correct internal endpoint when the generated `.zip` file is copied to the Liferay `osgi/client-extensions` deploy folder. Modifying these properties will override the auto-registration and break the deployment.
## Liferay Build Environment Constraints

- **Rationale**: The project requires modern frontend build tools (Vite 6, React 19) which are incompatible with the platform's default Node.js version. We have explicitly configured the environment to maintain parity with modern standards while adhering to Liferay Workspace limitations.
- **Node.js**: Enforced at `v22.22.2` via `build.gradle` `nodeVersion` configuration.
- **Build Infrastructure**: Standardized on Vite 6.0.0 and modern build dependencies across all client extensions to resolve native binary and ESM/CJS compatibility conflicts.
- **Test Pipeline**: The test suite is executed during the automated build pipeline. The known environment-level ESM loading issues (`ERR_REQUIRE_ESM`) in the test runner have been resolved with the upgrade to Node v22.
- **Guidance**: If build/deploy failures occur, always ensure the `.gradle/node` cache is cleared (`rm -rf .gradle/node`) before re-running the build to force synchronization with the project's enforced Node version.
- **Dismissal of Alerts**: Any dependabot alerts recommending upgrades for build tools should be reviewed against these pinned versions before applying.

---

# Workflow State, Batch Correlation, and WebSocket Progress Specification

## Media Attachment Strategy

Media assets (Images and PDFs) must be submitted to Liferay via its Headless APIs using one of the following patterns:

- **URL-based**: Provide a publicly reachable URL (e.g., from a CDN or external provider like Picsum) to the `/by-url` endpoints.
- **Base64-based**: Submit file content as a Base64 string to the `/by-base64` endpoints.
- **Multipart**: Upload files using standard `multipart/form-data`.

**Live Mode**: Triggers real-time generation of images (e.g., via DALL-E) or PDFs (via jsPDF) and submits them to Liferay.
**Demo Mode**: Uses static placeholders, user-supplied assets, or skips attachment based on configuration.

### Object Storage Service Role

The `ObjectStorageService` is **not** used for hosting assets for Liferay consumption. Its purpose is restricted to:

1.  **Data Preservation**: Storing generated AI payloads, images, and documents for offline analysis.
2.  **Export/Import Support**: Enabling the "Replay" feature where a full generation run can be reconstructed without re-invoking AI models.

### Dataset Portability & Replication

To ensure environment parity and support the "Replay" feature, the system mandates comprehensive data preservation:

1.  **Dependency Capture**: Generators MUST capture and store the full metadata of created foundation entities (Specification Categories, Specification Definitions, Option Definitions) in the session context.
2.  **Asset Metadata**: Media generators return metadata for created images and PDFs (ERC links, titles) to be persisted in the session, allowing these relationships to be reconstructed in new environments.
3.  **Ordered Import**: The backend import logic handles entities in their logical dependency order: Foundations (Warehouses, Specs, Options) followed by Primary Entities (Products, Accounts, Orders).
4.  **ERC-First Replication**: All exported data uses External Reference Codes as the primary linking mechanism to ensure stability across different Liferay instances.
5.  **Deterministic Child ERCs**: To prevent collisions and support iterative updates, child entities (Price Entries, Tier Prices, Inventory) MUST use deterministic ERCs built from their natural keys (e.g., `PE-{SKU}-{PRICELIST}`).

## Purpose

Define a clear, race-safe, event-driven architecture for multi-step
workflows (generation/deletion) that: - Maintain workflow context across
steps - Safely correlate async batch callbacks - Stream progress to the
frontend via WebSockets - Provide strong observability and
debuggability - Avoid race conditions, cache timing issues, and hidden
coupling

This specification is intended to be used as **AI context** when
building or refactoring the system.

---

## Non-negotiable constraints

- All code must be **self-documenting** and contain **no comments**
- The AI agent must **not**:
  - build, deploy, or test the project
  - make source control changes (commits, reverts, rebases, etc.)
- The AI agent **should**:
  - perform dry code analysis
  - reason about control flow, concurrency, idempotency, and failure
    paths
  - surface likely bugs or race conditions early

---

## Deployment context (Liferay-based architecture)

The solution is deployed into a **Liferay workspace** and composed of
multiple cooperating components built using the **Client Extensions
framework**.

### Components

- **Frontend UI client extension**
  - Subscribes to WebSocket events
  - Displays workflow progress and errors
- **Configuration UI client extension**
  - Exposed in the Liferay application menu
  - Stores longlived configuration via Liferay Objects
- **Batch client extension**
  - Defines and populates configuration and structural data models
    in Liferay
- **Microservice**
  - Central orchestrator
  - Owns workflow execution, batching, callbacks, and WebSocket
    messaging
  - Communicates with Liferay via Headless APIs

The microservice is the authority for workflow execution and
correctness.

---

## Liferay Accelerator SDK Modularization

To ensure architectural high-integrity and promote reusability across multiple accelerators, the system is split into two distinct layers:

### 1. Liferay Protocol & Engine Layer (`@liferay/accelerator-sdk`)

- **Responsibility**: Hardened communication and stateful workflow execution.
- **Components**:
  - **`LiferayService`**: High-level unified client (REST, GraphQL, Batch).
  - **`BaseGenerator`**: Master orchestrator for multi-step async workflows.
  - **`PersistenceService`**: SQLite-backed session and batch state management.
  - **`BatchCallbackService`**: Asynchronous reconciliation for Liferay Batch jobs.
  - **`OAuthService`**: Automated token lifecycle and platform-aware discovery.
  - **`GeneratedLiferayClient`**: Namespaced, version-aware fluent client.
- **Maintenance**: Stays in sync via `yarn sync` and `yarn generate` scripts.

### 2. Domain Orchestration Layer (Microservice)

- **Responsibility**: Accelerator-specific business logic and AI prompts.
- **Components**:
  - **Data Generators**: Specialized logic (Product, Account, Order).
  - **AI Integration**: Prompt engineering and provider management.
  - **Infrastructure**: Queue management (BullMQ) and WebSocket streaming.

---

## OData Filtering & API Constraints

To ensure maximum compatibility across Liferay's diverse Headless API implementations (specifically verified on **DXP 2025.Q1**), the following OData and filtering patterns must be strictly followed:

### 1. The "Filter-In-Memory" Mandate

Empirical testing confirms that Liferay's REST and GraphQL engines are inconsistent when handling complex filters.

- **The Rule**: **NEVER** use complex OData filters (e.g., `ne`, `not`, or deep `or` conditions) for discovery.
- **The Pattern**: Fetch all relevant items using a simple, stable filter (like `catalogId eq 123` or no filter at all) and perform all exclusions, prefix matching (`AICA-`), and UUID pattern verification strictly in **JavaScript memory**.
- **Rationale**: This bypasses "400 Bad Request" errors on unstable fields (like `name`) and prevents the "Fatal GraphQL death filter" bug.

### 2. Implementation Caveats & Mandatory Patterns

- **Operator Ban (`sw` and "startswith")**: **NEVER** use `sw` or `startswith()` operators for prefix filtering. These operators are inconsistently supported and frequently trigger `DataFetchingException: null` (500 error) in Liferay's Headless GraphQL fetchers, particularly for `headlessAdminUser`.
- **FATAL: GraphQL Filter Bug**: Empirical testing confirms that **ANY** complex filter on the `headlessAdminUser` namespace (e.g., `id eq ... or id eq ...`) can trigger a fatal `null` exception in Liferay's data fetchers.
- **Regional Metadata Fallbacks**: Liferay's Headless API for Addresses strictly validates the `addressRegion` field. Providing placeholder strings like "N/A" will result in a `400 Bad Request`. Always provide `null` if a region cannot be determined.

---

## Indirect Relationship Glue (Liferay Commerce 2025.Q1)

In newer Liferay Commerce versions, Catalogs and Channels are decoupled. For a store to function, the "Glue" must be explicitly established via indirect relationships:

1.  **Product Visibility**: Every product must be linked to a channel via the **`/product-channels`** API. Without this, products will not appear in the storefront.
2.  **Inventory Visibility**: Every warehouse must be linked to a channel via the **`/warehouse-channels`** API. Without this, stock levels will remain at zero in the checkout, regardless of warehouse items.
3.  **ERC-First Resilience**: Always use the `by-externalReferenceCode` path for establishing these links to bypass search index lag.

---

## Strict DTO Hardening

Liferay's newer Headless APIs (2024.Qx+) enforce strict metadata validation for nested relationships:

- **Full Metadata Objects**: Many DTOs (e.g., `Specification`) require a **Full Parent Object** instead of a flat ID.
  - _Correct_: `"optionCategory": { "id": 123, "key": "spec-group", "title": { "en_US": "Specs" } }`
  - _Incorrect_: `"optionCategoryId": 123`
- **Indexing Heartbeats**: Implement a **2-3 second delay** between linking a child to a parent (e.g., Options to Product) and performing dependent operations (e.g., creating SKUs or Inventory). This allows Liferay's internal relationship mapping to settle.
- **Pricing Resilience**: Pricing V2.0 strictly requires the **`discountDiscovery`** boolean in the `PriceEntry` DTO. Omitting it will cause a backend `NullPointerException`.

---

## Automated Quality Guardrails

To prevent regression and ensure 100% architectural integrity, the following automated checks are mandatory:

1.  **Service Parity Testing**:
    - **Rule**: Every public wrapper method in `LiferayService` (index.cjs) MUST have a corresponding implementation in either `LiferayRestService` or `LiferayGraphqlService`.
    - **Enforcement**: Verified via `tests/serviceParity.test.cjs`. This prevents `TypeError: ... is not a function` errors.
2.  **Startup Step Verification**:
    - **Rule**: Every workflow step registered in a Generator (e.g., `[S.CREATE_PRODUCTS]`) MUST be mapped to a valid class method.
    - **Enforcement**: The `BaseGenerator.verifySteps()` method is called at boot time in `bootstrap.cjs`. The microservice will fail to start if any mapping is broken.
3.  **Pre-Commit Verification**:
    - **Rule**: All code and documentation must be free of syntax errors, undefined references, and lint violations.
    - **Enforcement**: Husky and `lint-staged` run `eslint --fix`, `vitest run`, and `markdownlint` on every commit. This catches `ReferenceError`, `SyntaxError`, and documentation drift before they reach the repository.

---

## Storage strategy

### Guiding principle

**Workflow execution state must not depend on Liferay availability or
Headless API latency.**

### Hybrid Persistence Model

The microservice employs two distinct storage layers to balance resilience, performance, and data isolation.

#### 1. Workflow Persistence Layer (`PersistenceService`)

This layer manages the canonical state of all asynchronous operations (sessions, batches, and events).

- **Primary Store (Source of Truth):**
  - A local **SQLite** database (`workflows.db`).
  - **Durability**: Preserved across process restarts, enabling session resumption and reliable audit trails.
  - **Schema**: Includes `workflow_sessions`, `workflow_batches`, and `workflow_events` tables.
- **Implementation (SQLite + better-sqlite3):**
  - Uses the `better-sqlite3` driver for high-performance, synchronous, atomic writes to ensure state integrity during concurrent callbacks.
- **Consistency Model (Write-Invalidate):**
  - **Reads**: Checks cache first; on miss, loads from SQLite and populates cache.
  - **Writes/Updates**: All mutations are written directly to SQLite first. Immediately following a successful write, the corresponding cache entry is **invalidated (deleted)**.

---

## AI Multi-Provider Strategy (Text vs. Media)

To provide maximum flexibility and cost optimization, the microservice supports independent AI drivers for different content types.

1.  **Independent Keys**: Text generation (Products, Accounts, Orders) and Media generation (Images, PDFs) can be configured with separate API keys and providers.
2.  **Nano Banana Support**: Dedicated provider for specialized image generation.
3.  **Intelligent Fallback**: Media tasks will automatically fall back to the Core AI provider if no dedicated media key is provided, ensuring seamless operation for single-provider setups.
4.  **Provider Factory**: All AI interactions must go through `providerFactory.cjs` to ensure consistent error handling and model normalization.

---

## UI/UX Standards & Layout Real-Estate

The user interface must reflect a premium, professional standard, characterized by:

1.  **Horizontal Space Optimization**: Prefer multi-column grids (e.g., the 2-column generator settings) to minimize vertical scrolling on desktop.
2.  **Information Density**: Use compact card layouts and high-fidelity components like the `OverallProgressGauge` and `SystemStatus` strip to provide maximum data with minimal clutter.
3.  **Interactive States**: Use button groups, toggles, and range sliders for configuration parameters to provide immediate visual feedback.
4.  **Sticky Context**: Key navigation and configuration elements should be sticky on large screens to maintain accessibility during long generation runs.

---

## Dependabot & Lockfile Integrity (Operational Rule)

- **Conflict Prevention**: To prevent 'npm_and_yarn' conflicts in CI and Dependabot, **NEVER** commit a `package-lock.json` file. Yarn is the authoritative package manager for this monorepo.
- **Explicit Scoping**: The `.github/dependabot.yml` file explicitly defines the ecosystem and directories for automated updates to ensure monorepo-wide consistency.

---

## Native Identifier Strategy (Engineering Rule)

- **Eliminate `uuid` Dependency**: To reduce security surface area and avoid CommonJS/ESM compatibility friction, **DO NOT** use the `uuid` npm package in the microservice.
- **Authority**: Use Node.js's built-in **`crypto.randomUUID()`** for all random identifier generation (ERCs, correlation IDs, task IDs).

---

## Clean Code & Linting (Engineering Rule)

- **Zero Warning Mandate**: The codebase must be free of lint warnings and formatting errors.
- **Intentional Omissions**: Use the **`_` (underscore)** prefix for any intentionally unused parameters, variables, or caught errors (e.g., `const { unused: _unused } = obj`, `catch (_err) {}`). The ESLint config is hardened to support this pattern without warnings.

---

## Core identifiers

### sessionId

Primary identifier for a workflow run and UI subscription.

### erc

Primary identifier for a batch submission and callback correlation.

### wsCorrelationId

Identifier for correlating WebSocket messages and logs.

### errorRef

Identifier for correlating user-visible errors and server logs.

---

## Agent Analysis (Self-Correction & Findings)

### Deletion Discovery & Sequencing (Analysis Finding)

Analysis of the account deletion failure revealed a critical conflict between workflow sequencing and entity discovery logic:

1.  **Sequencing Dependency**: `deleteOrders` must precede `deleteAccounts` due to Liferay referential integrity.
2.  **Discovery Flaw**: `LiferayService.getAccounts` relies on querying existing orders when a `channelId` is provided. If orders are already deleted, discovery returns zero results.
3.  **Corrective Pattern (Comprehensive Manifest)**: Deletion discovery MUST perform a complete sweep of all entities (**Orders, Products, Accounts, Warehouses, Price Lists, Promotions, Specifications, and Options**) _before_ any deletion begins. This captures volatile IDs and relationships while links are still valid.
4.  **Property Resilience**: Discovery logic must check both `erc` and `externalReferenceCode` to account for variations in Liferay's Headless DTO property naming.

### Product Type Constraint (API Finding)

Investigation of product creation failures (`CPDefinitionProductTypeNameException`) revealed a critical API constraint:

1.  **Mandatory Type**: The Liferay Headless Commerce API requires the `productType` field to be `simple` for all products during initial creation.
2.  **Actionable Pattern**: All generator logic, AI prompts, and schemas must strictly use `productType: 'simple'`.

### SKU Property Constraints (API Finding)

1.  **Unsupported Fields**: The `Sku` DTO does not recognize an `active` property. Including it will cause import failure.
2.  **Activation Rule**: A SKU linked to a product with SKU-contributing options is active only if it has an explicit `skuOption` entry for **every** contributing option.

### Batch Engine Verb Support (Unusual Behavior)

- **Constraint**: Not all Liferay Batch Engine endpoints support the HTTP `DELETE` verb.
- **Example (v1.0 Legacy)**: Older commerce entities (Warehouses, Orders, Accounts, Specs, Options) often fail or ignore global batch 'DELETE' strategies. For these types, use **Simulated Batch Deletion** (sequential individual `DELETE` requests) to ensure 100% cleanup reliability and accurate progress reporting.

### Resilient Order Generation (Indexing Workaround)

1.  **The Race Condition**: Immediately after creating products and SKUs, Liferay's search index may not be updated. Queries like `getProductsWithSkus` may return 0 SKUs, causing order generation to crash with "No purchasable SKUs found."
2.  **The Solution (Context Merging)**: The generator now uses a **Session Context Fallback**. If the API returns incomplete data, the system automatically injects resolved SKU IDs directly from the persistent session memory (the `productDataList`).

### Security & History Hygiene (Operational Finding)

1.  **Purge Policy**: Sensitive files (`workflows.db`, `*.log`) must be purged from Git history using `git-filter-repo` if accidentally committed.
2.  **Resolution Lockdown**: Always use `resolutions` in root `package.json` to override nested vulnerabilities (e.g., `uuid`, `axios`, `braces`).
3.  **Lock File Single Source**: Maintain only `yarn.lock`. Delete `package-lock.json` to prevent CI conflicts.
4.  **CI Cleanup**: Delete any failed GitHub Action jobs (e.g., via `gh run delete`) to maintain a clean workflow history.

---

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

---

## Dynamic Asset Management

The microservice serves as the source of truth for product placeholders, moving away from heavy frontend-bundled Base64 strings.

1.  **File-Based Storage**: Images are stored in `public/placeholders/` within the microservice.
2.  **Lazy Conversion**: Assets remain binary on the server and are only converted to Base64 strings when a user selects them in the Configuration UI to update Liferay's global settings.
3.  **Auto-Derived Labeling**: The UI gallery automatically generates professional titles (e.g., "Liferay Product Default") from filenames (`liferay_product_default.webp`), eliminating the need for a metadata database.
4.  **Sanitized Custom Uploads**: User-uploaded images are sanitized to `snake_case` filenames and deduplicated with timestamps to ensure filesystem consistency.

---

## Known Operational States

- **Demo Mode**: Uses deterministic ERCs for addresses. Repeated runs will trigger "Duplicate address" errors unless the database is cleared.
- **Liferay Password**: Default local development password is set to `L1feray$`.
- **Node Version**: v24.0.0+ is the current target; ensure native modules are rebuilt if switching environments.

---

## The "Staging & Atomic Move" Deployment Pattern

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

---

## Liferay Stylebook Compatibility Patterns

Empirical testing across DXP 2024.Qx and 2025.Q1 environments has revealed critical stability constraints for Stylebook client extensions:

### 1. The "Zero-Warning" Import Rule

Liferay strictly validates the `themeId` field in the Stylebook's `style-book.json`.

- **The Finding**: Even when targeting the standard "Classic" theme, explicitly setting `"themeId": "classic"` frequently triggers a "different from default theme" warning during import.
- **The Solution**: Set **`"themeId": ""`** (empty string). This bypasses the validation mismatch and allows for a clean, warning-free import into any site.

### 2. Sidebar Crash Avoidance (`defaultValue` Error)

The Liferay Stylebook Sidebar (the visual property editor) will crash with a fatal JavaScript error (`TypeError: Cannot read properties of undefined (reading 'defaultValue')`) if it encounters a token value in `frontend-tokens-values.json` that does not have a corresponding definition in the DXP theme's internal schema.

- **The Rule**: **NEVER** include unmapped custom token keys (e.g., `brand-color-1`) or complex font stacks in the JSON file.
- **The Pattern**: Use the **Liferay Token Mapping structure** to ensure tokens are correctly mapped to CSS variables and visible in the Sidebar property editor:

  ```json
  {
    "primaryColor": {
      "cssVariableMapping": "primary",
      "value": "#0053f0"
    },
    "brandColor1": {
      "cssVariableMapping": "brand-color-1",
      "value": "#00d1ff"
    }
  }
  ```

- **The Alpha/Reference Guard**: DXP supports `rgba()`, `transparent`, and cross-token references (using the `"name": "tokenName"` key within the value object).

### 3. CSS-Autority Theming

Because the Stylebook zip is an unreliable carrier for custom brand tokens:

- **Mandatory Pattern**: Define all "High-End" brand colors (e.g., Electric Cyan, Vivid Purple) and typography defaults directly in the project's **SCSS (`app.scss`)** as CSS variables or hardcoded fallbacks.
- **Rationale**: This ensures the application looks premium immediately upon deployment (hosted inside or outside Liferay) without requiring a fragile token-mapping step in the DXP UI.

### 4. Custom Accent Color & Form Control Synchronization

To ensure exact color parity between the DXP Stylebook and browser-rendered form controls:

- **`accent-color` Authority**: Always apply `accent-color: var(--aica-primary-authority) !important` to the dashboard root. This forces native checkboxes and radio buttons to follow the theme's primary color.
- **Range Slider "Shadow-Fill" Trick**: Browser-default range sliders often resist standard coloring for the "progress" (left) side of the thumb.
  - **The Pattern**: Use a combination of `overflow: hidden` on the input and a massive `box-shadow` on the thumb (`box-shadow: -100vw 0 0 100vw var(--aica-primary-authority) !important`).
  - **Vendor Hardening**: Explicitly style `::-webkit-slider-runnable-track` and `::-webkit-slider-thumb` to bypass Liferay's default global CSS.
- **Spacing & Alignment**: Custom checkboxes (W3C pattern) should use `display: flex`, `align-items: flex-start`, and a minimum `gap: 1.5rem` to ensure high-end spacing and perfect vertical alignment with multi-line labels.

---

## Liferay v2.0 Pricing & Batch APIs (Engineering Rules)

Extensive empirical testing against Liferay DXP (2025.Q1) revealed strict constraints regarding the `v2.0` Headless Pricing API and the Headless Batch Engine:

### 1. Batch Endpoints: POST vs PUT

- **Rule**: Liferay's Headless Batch Engine endpoints (e.g., `/v2.0/price-lists/price-entries/batch`) **strictly expect the HTTP `POST` method** for batch creation operations.
- **The Pitfall**: Attempting to use `PUT` for UPSERT behavior on these endpoints will result in a `405 Method Not Allowed`.
- **The Implication**: Since `POST` strictly performs a `CREATE` operation, sending a batch payload containing ERCs that already exist in the database will immediately trigger a `400 Bad Request` ("This external reference code is already in use"). You must clean/delete prior entries before generating new ones with the same ERCs.

### 2. Batch Tracking Query Parameter Collision

- **Rule**: When using a `/batch` endpoint, Liferay intercepts the `externalReferenceCode` URL query parameter and assigns it to the **Batch Import Task** itself (not the target entity).
- **The Pitfall**: If you incorrectly pass a target entity ERC (like `AICA-PL-GENERAL` for a Price List) in the query string (`?externalReferenceCode=AICA-PL-GENERAL`), Liferay will attempt to assign the Price List's ERC to the newly created Batch Task. This causes an immediate `400 Bad Request` collision.
- **The Pattern**: Always pass a dynamically generated, unique `batchERC` (e.g., `AICA-BATCH-12345`) in the query parameter to allow tracking via WebHooks, and define the target relationships strictly inside the JSON payload items.

### 3. Strict Pricing DTO Schemas

Liferay's Java deserializer for `PriceEntry` is extremely unforgiving. The JSON payload MUST exactly match the expected Object structure:

- **Nested SKU Object**: The `sku` property MUST be a nested object wrapper (e.g., `"sku": { "externalReferenceCode": "..." }` or `"sku": { "id": 123 }`). Sending a flat string (e.g., `"sku": "SKU-123"`) will trigger a Java constructor exception (`no String-argument constructor/factory method to deserialize from String value`).
- **Required Booleans**: The `hasTierPrice` boolean MUST be explicitly provided.
- **Extraneous Fields**: Do NOT send internal microservice state flags (like `bulkPricing` or `discountDiscovery`) in the payload, as the strict DTO validation will reject unknown properties.

### 4. Recursive ERC Deduplication

Liferay evaluates batch payloads recursively. If a single payload contains nested arrays (like `tierPrices` inside `priceEntries`), all ERCs within that nested array must be mathematically unique across the entire payload.

- **The Pitfall**: If the AI hallucinates two duplicate `tierPrices` (e.g., two entries for "minimum quantity: 10"), generating an identical `externalReferenceCode` for both, the entire batch will fail with "already in use", even on a clean database.
- **The Pattern**: Aggressively deduplicate nested properties (e.g., using a `Set` on `minimumQuantity`) in memory _before_ assembling the Liferay DTO.

---

## E2E Log Analysis Hardening

- **The Issue**: In `scripts/test-e2e-orchestrator.js`, the log analyzer `scripts/analyze-e2e-logs.js` is spawned without passing the log file location (`MS_LOG_FILE`) as an argument. This causes the analyzer to exit with code 1 immediately, marking even successful test runs as failed in the orchestrator log verification phase.
- **The Fix**: The orchestrator must explicitly pass `MS_LOG_FILE` to the spawned analyzer process.

---

## LDM Fast Login Configuration

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
