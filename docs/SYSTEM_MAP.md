# Liferay AI Commerce Accelerator - System Map

This document defines the architectural responsibilities and data flow for the entire Liferay AI Commerce Accelerator suite, detailing each client extension as a specialized subsystem.

## 1. Workspace Overview

The project is a multi-module Liferay Workspace using a headless-first architecture. A central microservice orchestrates data operations, while multiple UI and resource extensions handle presentation, configuration, and environment bootstrapping.

---

## 2. Subsystems

### 🚀 Microservice Subsystem (`ai-commerce-accelerator-microservice`)

**Role**: The central orchestrator and backend engine.

- **Responsibilities**: Workflow execution, AI integration (multi-provider), Liferay Headless API coordination, and real-time state broadcasting via WebSockets.
- **AI Integration**: Support for multiple providers including OpenAI (GPT) and Google Gemini via a unified driver architecture.
- **Core Directories**:
  - `generators/`: Defines the business logic and step sequences for entity creation/deletion (e.g., `ProductGenerator.cjs`).
  - `services/`: Core logic providers like `BatchCallbackService.cjs` (state machine), `LiferayService` (API facade), and `PersistenceService.cjs` (SQLite manager).
  - `routes/`: Express endpoints for initiating workflows and receiving Liferay batch callbacks.
  - `utils/`: Shared constants (`constants.cjs`) and API path helpers (`liferayPaths.cjs`).
  - `data/`: Location of `workflows.json` (SQLite database).
- **Stack**: Node.js (Express), SQLite (better-sqlite3).
- **Testing**: Vitest with MSW (Mock Service Worker) for Liferay API isolation.

### 🖥️ Frontend Subsystem (`ai-commerce-accelerator-frontend`)

**Role**: The primary control plane for the accelerator.

- **Responsibilities**: Subscribing to microservice WebSockets, displaying multi-step progress bars, and providing the user interface for generating and deleting data.
- **Core Directories**:
  - `src/components/`: Modular UI elements like `ProgressBar`, `StatusIndicator`, and `ControlPanel`.
  - `src/hooks/`: Custom React hooks for WebSocket communication (`useRealtimeWebSocket`), session management, and configuration IO (`useAppConfigIO`).
  - `src/state/`: Centralized state management using `progressReducer`.
- **Integration**: Embedded into Liferay via the `fragments/` wrapper.
- **Stack**: React, Vite.
- **Testing**: Vitest + React Testing Library + MSW for microservice API mocking.

### ⚙️ Configuration Subsystem (`ai-commerce-accelerator-configuration`)

**Role**: Administrative and settings management.

- **Responsibilities**: Providing a UI for managing AI credentials (API keys), prompt templates, and global generator thresholds.
- **Persistence**: Stores settings in Liferay Objects, retrieved by the Microservice at runtime.
- **Stack**: React (Client Extension).

### 📦 Batch Subsystem (`ai-commerce-accelerator-batch`)

**Role**: Structural and metadata definition.

- **Responsibilities**: Defining the Liferay Object folders, definitions, and entries required for the system's own configuration and auditing.
- **Key Files**: `batch/*.json` (Batch Engine descriptors for system entities).

### 🏗️ Site Initializer Subsystem (`ai-commerce-accelerator-site-initialiser`)

**Role**: Environment bootstrapping.

- **Responsibilities**: Automatically provisioning the initial Liferay Site, Commerce Catalogs, and Channels required for the accelerator to operate on a fresh Liferay instance.

---

## 3. Shared Resources

### `/fragments`

- **Fragment Wrapper**: A Liferay Page Fragment that hosts the Frontend UI, ensuring CSS/JS scoping and Liferay theme compatibility.

### Schemas (`/api-schemas` & `/generation-schemas`)

- **`api-schemas/`**: Authoritative OpenAPI and GraphQL definitions from Liferay, used for request validation and SDK generation.
- **`generation-schemas/`**: JSON schemas that define the data contract between AI models and the microservice generators.

---

## 4. Testing Strategy

The project employs a tiered testing strategy to ensure reliability across all layers:

- **Unit Tests**: Verified logic in isolation (Reducers, Selectors, Utility functions).
- **Service Tests**: Mocks external dependencies (Liferay, OpenAI) via MSW to verify service-level interactions.
- **Integration Tests**: Verifies multi-component flows (e.g., App -> Context -> Configuration Panel -> Connection Test).
- **Smoke Tests**: Cross-component verification using Playwright (Server + UI).
- **Schema Validation**: Authoritative AJV validation for all AI and Mock data payloads.
- **E2E Verification**: End-to-end flow validation using Playwright and a dedicated log analyzer.
  - `scripts/test-e2e-orchestrator.js`: Manages the lifecycle of the microservice and triggers the test suite.
  - `scripts/analyze-e2e-logs.js`: Performs forensic analysis of microservice logs to detect silent failures (ERROR/FATAL).
  - `playwright/playwright-e2e.config.js`: Configuration for the E2E verification suite.
- **Legacy API Support**: Overview of [JSON Web Services (JSONWS)](./JSONWS_GUIDE.md) for internal portal access.

---

## 5. Cross-Subsystem Workflows

### Data Generation Workflow

1. **Frontend**: User initiates a request.
2. **Microservice**: Creates a `workflow_session` in SQLite and starts a `Generator`.
3. **Microservice -> Liferay**: Submits asynchronous batches; persists state _before_ submission.
4. **Liferay -> Microservice**: Sends batch callbacks to the `batch.cjs` route.
5. **Microservice -> Frontend**: `BatchCallbackService` advances the state and broadcasts `PROGRESS` events via WebSockets.
6. **Frontend**: Updates progress bars and status displays for the user.

### Environment Deletion Workflow

1. **Microservice**: `DeleteCoordinatorService` initiates the **Manifest-First Discovery** phase (`DISCOVER`). It crawls the Liferay instance to find all relevant entities (Orders, Accounts, Warehouses, Products, etc.) and stores their full metadata (ID, ERC, Name) in a session manifest.
2. **Exclusion Check**: During discovery, the system automatically cross-references entities against the **Exclude Lists** (configured in Liferay Objects).
3. **Execution**: The service executes a dependency-aware sequence:
   _DISCOVER -> Reset Config -> Orders -> Warehouse Items -> Warehouses -> Accounts -> Options -> Specifications -> Products -> Pricing._
4. **Resilience**: Deletions are performed using the metadata in the manifest, bypassing the need for redundant API calls during the deletion phase and ensuring OData compatibility by using `OR` filters instead of `IN` filters.

---

## 6. WebSocket Event Contract

The Microservice and Frontend communicate via WebSockets using a hierarchical **Scope/Status** model. This ensures real-time, granular feedback for long-running workflows.

### Event Structure (JSON)

All `PROGRESS` packets MUST follow this structure:

```json
{
  "type": "STARTED | PROGRESS | COMPLETED | FAILED",
  "scope": "session | step | batch",
  "entityType": "products | accounts | orders | warehouses | images | pdfs",
  "operation": "generate | delete | process-images | process-attachments",
  "sessionId": "SESS-123",
  "batchId": "456",
  "processedCount": 50,
  "totalCount": 100,
  "error": "Optional error message or object",
  "correlationId": "CID-789"
}
```

### Critical Sync Rule

Any change to the event emission logic in `ProgressService.cjs` (Server) MUST be matched by a corresponding update in `progressReducer.js` and `useRealtimeWebSocket.js` (Frontend).

### Logic Mapping

- **`STARTED` (session)**: Triggers `RESET_ALL` in the frontend to initialize progress bars.
- **`PROGRESS` (batch/step)**: Triggers `SET_COMPLETED` using `processedCount`.
- **`COMPLETED` (step)**: Marks the `entityType` as 100% complete.
- **`FAILED`**: Propagates errors to the `ADD_ERRORS` action for UI display.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
