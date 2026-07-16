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

---## Storage strategy

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

---## AI Multi-Provider Strategy (Text vs. Media)

To provide maximum flexibility and cost optimization, the microservice supports independent AI drivers for different content types.

1.  **Independent Keys**: Text generation (Products, Accounts, Orders) and Media generation (Images, PDFs) can be configured with separate API keys and providers.
2.  **Nano Banana Support**: Dedicated provider for specialized image generation.
3.  **Intelligent Fallback**: Media tasks will automatically fall back to the Core AI provider if no dedicated media key is provided, ensuring seamless operation for single-provider setups.
4.  **Provider Factory**: All AI interactions must go through `providerFactory.cjs` to ensure consistent error handling and model normalization.

---## Dynamic Asset Management

The microservice serves as the source of truth for product placeholders, moving away from heavy frontend-bundled Base64 strings.

1.  **File-Based Storage**: Images are stored in `public/placeholders/` within the microservice.
2.  **Lazy Conversion**: Assets remain binary on the server and are only converted to Base64 strings when a user selects them in the Configuration UI to update Liferay's global settings.
3.  **Auto-Derived Labeling**: The UI gallery automatically generates professional titles (e.g., "Liferay Product Default") from filenames (`liferay_product_default.webp`), eliminating the need for a metadata database.
4.  **Sanitized Custom Uploads**: User-uploaded images are sanitized to `snake_case` filenames and deduplicated with timestamps to ensure filesystem consistency.

---## Core identifiers

### sessionId

Primary identifier for a workflow run and UI subscription.

### erc

Primary identifier for a batch submission and callback correlation.

### wsCorrelationId

Identifier for correlating WebSocket messages and logs.

### errorRef

Identifier for correlating user-visible errors and server logs.

---
