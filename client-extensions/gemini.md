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
3.  **Corrective Pattern**: Deletion discovery for entities with complex or volatile relationships MUST prioritize stable identifiers and robust discovery methods. Use the `search` parameter where supported, or fetch larger result sets and perform **memory filtering** based on prefixes (e.g., `AICA-`).

### Product Type Constraint (API Finding)

Investigation of product creation failures (`CPDefinitionProductTypeNameException`) revealed a critical API constraint:

1.  **Mandatory Type**: The Liferay Headless Commerce API requires the `productType` field to be `simple` for all products during initial creation.
2.  **Actionable Pattern**: All generator logic, AI prompts, and schemas must strictly use `productType: 'simple'`.

### SKU Property Constraints (API Finding)

1.  **Unsupported Fields**: The `Sku` DTO does not recognize an `active` property. Including it will cause import failure.
2.  **Activation Rule**: A SKU linked to a product with SKU-contributing options is active only if it has an explicit `skuOption` entry for **every** contributing option.

### Batch Engine Verb Support (Unusual Behavior)

- **Constraint**: Not all Liferay Batch Engine endpoints support the HTTP `DELETE` verb.
- **Example**: For entity types that lack native batch deletion support, use **Simulated Batching** (sequential individual `DELETE` requests) or direct REST batch endpoints if available.

### Security & History Hygiene (Operational Finding)

1.  **Purge Policy**: Sensitive files (`workflows.db`, `*.log`) must be purged from Git history using `git-filter-repo` if accidentally committed.
2.  **Resolution Lockdown**: Always use `resolutions` in root `package.json` to override nested vulnerabilities (e.g., `uuid`, `axios`, `braces`).
3.  **Lock File Single Source**: Maintain only `yarn.lock`. Delete `package-lock.json` to prevent CI conflicts.
4.  **CI Cleanup**: Delete any failed GitHub Action jobs (e.g., via `gh run delete`) to maintain a clean workflow history.

---

## Known Operational States

- **Demo Mode**: Uses deterministic ERCs for addresses. Repeated runs will trigger "Duplicate address" errors unless the database is cleared.
- **Liferay Password**: Default local development password is set to `L1feray$`.
- **Node Version**: v24.0.0+ is the current target; ensure native modules are rebuilt if switching environments.

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
