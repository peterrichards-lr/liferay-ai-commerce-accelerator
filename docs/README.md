# Liferay AI Commerce Accelerator

The Liferay AI Commerce Accelerator is a workspace project designed to rapidly generate and deploy sample commerce data (products, accounts, orders) into a Liferay DXP instance using generative AI. It consists of several interconnected client extensions that provide a user interface for configuration, a microservice for application logic, and batch processes for data loading.

## Components

The accelerator is composed of four main parts that work together:

1.  **Configuration UI (`ai-commerce-accelerator-configuration`)**: A React-based client extension that provides a user interface within the Liferay application menu. Administrators use this UI to configure AI provider settings, API keys, and the content of AI prompts and schemas. The panels have been reordered for a more user-friendly flow, and all JSON/Markdown input fields now feature a standardized CodeMirror editor with enhanced features like line numbers, code folding, and bracket matching.

1.  **Frontend (`ai-commerce-accelerator-frontend`)**: The main user-facing client extension, also based on React. This application allows users to specify the quantity and type of commerce data to generate, monitor the generation process in real-time, and manage the generated data.

1.  **Microservice (`ai-commerce-accelerator-microservice`)**: A Node.js Express server that acts as the brain of the accelerator. It receives requests from the frontend, communicates with the AI service to generate data, and then uses Liferay's Headless APIs to create the commerce data in DXP.

1.  **Batch Loader (`ai-commerce-accelerator-batch`)**: This client extension contains the initial, default data for the AI prompts and schemas. It uses Liferay's Batch Engine to load this configuration into Liferay's object storage.

## Architectural Overview: Data Generation Workflow

The microservice employs a sophisticated, stateful, and asynchronous architecture to manage the creation of large amounts of commerce data. Understanding this workflow is key to extending or debugging the service.

- **Stateful Workflow Engine**: At its core, the system is a state machine orchestrated by `batchCallbackService.cjs`. It uses a local **SQLite** database (`persistenceService.cjs` / `workflows.db`) to track the state of every generation job, including the sequence of steps and the status of each batch submitted to Liferay. This makes the process resilient to server restarts.

- **High-Performance Persistence**: The microservice uses `better-sqlite3` for fast, synchronous, and atomic data operations, ensuring state integrity even during rapid asynchronous callbacks from Liferay.

- **Asynchronous Batch Processing**: The architecture is designed around the limitations of Liferay's Headless Batch APIs.
  1.  **Stateless Callbacks**: Liferay's batch engine callback does not contain context about the original request.
  2.  **`batchERC` for Correlation**: To work around this, the microservice generates a unique identifier (`batchERC`) for each batch it submits. This ERC is appended as a query parameter to the callback URL.
  3.  **State Lookup**: When Liferay calls the microservice's callback endpoint, the service uses the `batchERC` from the URL to look up the original context from its database, allowing it to resume the correct workflow.

- **Handling Entity Dependencies**: When creating entities with parent-child relationships (like Accounts and their Postal Addresses), the APIs often require the parent's numeric ID. Because of this constraint, the workflow must follow a multi-step process:
  1.  Submit a batch to create the parent entities (e.g., Accounts).
  2.  Wait for the batch to complete.
  3.  Fetch the newly created parent entities to retrieve their system-generated IDs.
  4.  Submit a new batch to create the child entities (e.g., Postal Addresses), now with the necessary parent IDs.

This pattern, while adding steps, is a necessary consequence of the API design and ensures data integrity.

### Batch Statuses

The `status` property within the `batches` array is critical for orchestrating the workflow and signaling the UI. The possible statuses are:

- **`PREPARED`**: A batch has been created in the microservice's local database but has not yet been submitted to the Liferay Batch Engine.
- **`SUBMITTED`**: The batch has been successfully sent to the Liferay Batch Engine and is either queued or is actively being processed.
- **`COMPLETED`**: Liferay's Batch Engine has finished processing the batch with no errors. This status is critical for the UI's progress bars.
- **`FAILED`**: Liferay's Batch Engine encountered an error and could not process the batch.
- **`BYPASSED`**: A step that could have involved a Liferay batch was intentionally skipped due to user configuration, conditional logic, or because the data set was empty. This indicates a "null-op" where a batch was a possibility but wasn't necessary this time.
- **`SYNCHRONOUS`**: This step in the workflow never involves the Liferay Batch Engine by design. It represents internal microservice logic, data enrichment, or synchronous API calls.

### Configurable Categories

The available product categories are now dynamically configurable via the "AI Commerce Accelerator Configuration" UI. The categories are stored as a Liferay Object and can be managed through a dedicated panel, allowing administrators to easily update the product catalog without code changes.

### Exclude Lists

The application now supports configurable exclude lists for products, accounts, and warehouses. This allows administrators to prevent specific items from being displayed in lists or being deleted during cleanup operations.

- **New Configuration Panel:** A new **Exclude Lists** panel is available in the **AI Commerce Accelerator Configuration** screen.
- **How it Works:** In this panel, you can provide a JSON object containing arrays for `excludedProducts`, `excludedAccounts`, and `excludedWarehouses`. Each item in the arrays is an object that can specify an exclusion by `entityId`, `erc` (External Reference Code), or `name`. The microservice will use these lists to filter out the specified items from any queries.

## Deployment

To ensure that the application functions correctly, it is critical to deploy all client extensions to your Liferay instance. This is especially important for the `ai-commerce-accelerator-batch` extension, which contains the necessary data definitions for the Liferay Objects used by the accelerator.

### Full Deployment

To perform a full, clean deployment of all client extensions, run the following command from the root of the project:

```bash
blade gw clean deploy
```

This command will build all the client extensions and deploy them to your Liferay instance.

### `generateBatchFiles` Task

This project includes a Gradle task called `generateBatchFiles` that automatically creates batch files for AI schemas and prompts. These generated files are placed in the `client-extensions/ai-commerce-accelerator-batch/batch/` directory and are then deployed to Liferay as part of the `ai-commerce-accelerator-batch` client extension.

**Important:** The `ai-schemas` and `prompts` located in the `ai-commerce-accelerator-microservice` project are the single source of truth. If you need to make changes to the schemas or prompts, you should edit the files in these directories. The `generateBatchFiles` task will automatically update the batch files in the `ai-commerce-accelerator-batch` project when you build and deploy the project. You should not edit the batch files in `ai-commerce-accelerator-batch/batch/` directly, as your changes will be overwritten.

### Microservice-Only Deployment

For development purposes, you can deploy and run the microservice independently. However, be aware that this will not deploy the other client extensions, and you may encounter errors if the object definitions in your Liferay instance are not up-to-date.

```bash
(rm -f client-extensions/ai-commerce-accelerator-microservice/logs/*.log || true) && blade gw :client-extensions:ai-commerce-accelerator-microservice:clean :client-extensions:ai-commerce-accelerator-microservice:deploy :client-extensions:ai-commerce-accelerator-microservice:packageRunDebug
```

## Features

### AI Model Options Configuration

The AI Model Options (which define the available AI models for generation) have been integrated directly into the "AI Configuration" screen within the `ai-commerce-accelerator-configuration` client extension.

- **Consolidated UI:** The separate "AI Model Options" panel has been removed and its functionality merged into `AiConfigPanel.jsx`. This provides a single, centralized location for managing AI-related settings.
- **Dynamic Validation:** The validation logic for AI model selection in the microservice's generation operations (`/api/generate/accounts`, `/api/generate/products`, `/api/generate/orders`) is now dynamic. Instead of hardcoded model lists, validation rules are generated at runtime based on the AI model options configured in Liferay.
- **Default Model Pre-selection:** The microservice's `/api/config/ai-model-options` endpoint now returns the `defaultModel` from the `ai-config` settings, ensuring the frontend UI can correctly pre-select the appropriate AI model in dropdowns. A fallback mechanism ensures that if the configured default model is not found in the available options, the first available model is used as the default.
- **Frontend UI Fix:** The AI Model dropdown in the frontend (`AdvancedPanel.jsx`) now correctly populates its values from the list returned by the microservice and pre-selects the default model. It also remains disabled until a connection to the microservice is established.

### WebSocket Initialization Refactor

The singleton pattern implemented via `wsBus.cjs` for managing the WebSocket instance proved problematic due to subtle timing and module loading issues in the Node.js environment, leading to persistent "WS not initialized" errors. To resolve this, the singleton pattern has been rolled back, and the WebSocket instance (`ws`) is now explicitly passed between relevant modules.

- **`wsBus.cjs` Removed:** The `client-extensions/ai-commerce-accelerator-microservice/services/wsBus.cjs` file has been deleted.
- **Explicit `ws` Instantiation:** In `server.cjs`, the WebSocket instance is now directly created using `createWebSocketService` from `webSocketService.cjs` and assigned to a local `ws` variable.
- **Explicit `ws` Passing:** The `ws` instance is now explicitly passed as an argument:
  - From `server.cjs` to `bootstrap.cjs`.
  - From `bootstrap.cjs` to relevant services and contexts (e.g., `BatchPollingService`, `entityGeneratorCtx`).
  - From `server.cjs` (via local `ws` or passed down) to route handlers (e.g., `routes/generate.cjs`, `routes/batch.cjs`).
- **Direct `emit` Calls:** Route handlers and service functions now directly use the passed `ws` instance (e.g., `getWs().emitError(...)`) instead of relying on a singleton `get()` method.

This ensures the WebSocket instance is always explicitly available and correctly initialized throughout its lifecycle, resolving the "WS not initialized" errors and restoring real-time communication functionality.

### Chained Deletion Process Fix

The "Delete All Commerce Data" operation has been made more reliable.

- **Improved Group Advancement Logic:** The `_startNextGroups` function in `batchCallbackService.cjs` was refactored to remove a premature `break` condition in its outer loop. Previously, the function would halt processing subsequent deletion groups if an earlier group was found to be incomplete and not the initial `fromGroupIndex`. The updated logic now ensures that `_startNextGroups` correctly iterates through all groups, skipping already completed ones and attempting to process incomplete ones, thus preventing the deletion chain from hanging.

#### Batch Callback Mechanism

**Important Architectural Note:** The microservice's batch callback handler (`/api/batch/callback`) is designed to extract contextual information (such as the entity type, operation code, or batch ERC) primarily from **URL query parameters**, not from the request body. This is because Liferay's Batch Engine callbacks transmit data through query parameters. Therefore, when setting up callback URLs, all necessary data required for subsequent chained operations must be encoded in the query string.

### Batch Error `correlationId` Retrieval Fix

Previously, `BATCH_ERROR_DETAILS` WebSocket events were sometimes emitted with an `unknown` or `undefined` `correlationId`, causing the frontend to miss these important error notifications. The `correlationId` is crucial for the frontend to associate an error with a specific generation session.

### Warehouse & Inventory Generation

The accelerator has been updated to support the generation of warehouses and the management of inventory using the new Commerce Admin Inventory API. This feature now works in both "demo" (mock) and "live" (AI) modes, and is now fully functional.

**Key Fixes:**

- **Correct Warehouse Creation:** The `warehouseGenerator.cjs` has been updated to correctly normalize AI-generated warehouse data (which includes localized names and descriptions) into the format expected by the Liferay Commerce Admin Inventory API before calling `liferayRestService.createWarehouse` (for individual creation) or `liferayRestService.createWarehousesBatch` (for batch creation). This resolves the issue where warehouses were not being created at all.
- **Real API Integration**: The previous mock implementation has been replaced with real API calls to the Commerce Admin Inventory API. The `liferayRestService.cjs` has to use the new endpoints for creating warehouses, getting warehouses, and updating product inventory.
- **AI-Powered Generation**: When not in demo mode, the accelerator will use generative AI to create warehouse data. This is handled by the `warehouseGenerator.cjs`, which calls a new `generateWarehouseData` function in the `aiService.cjs`. A new prompt (`warehouse.md`) and schema (`warehouse.json`) have been created for this purpose.
- **Frontend Integration**: The frontend `DataGeneratorForm.jsx` already included UI elements for enabling warehouse creation and setting inventory levels. These are now wired up to the new backend functionality.
- **Inventory Distribution**: The `productGenerator.cjs` has been updated to distribute the inventory of newly created products across the available warehouses. This is handled in the `createOnSessionComplete` method to ensure it runs after all products in a batch have been created.

### Batch Warehouse Creation

The microservice now supports batch creation of warehouses, enabling more efficient generation and real-time progress updates in the UI by leveraging a native Liferay batch endpoint.

- **`utils/liferayPaths.cjs` Update:** A new path, `PATH.WAREHOUSES_BATCH`, has been added, pointing to `/o/headless-commerce-admin-inventory/v1.0/warehouses/batch`.
- **`liferayRestService.cjs` Enhancement:** A new method, `createWarehousesBatch`, has been implemented. This method takes an array of warehouse data, generates a unique batch ERC (External Reference Code) for the batch, and caches the ERCs of individual items within the batch. It constructs a callback URL that includes batch and session information. It then makes a single `_post` request to the Liferay batch endpoint (`PATH.WAREHOUSES_BATCH`), sending the entire array of warehouse data. Submission details are cached, and a structured response containing the Liferay-provided `batchId` and status is returned.
- **`warehouseGenerator.cjs` Logic Update:**
  - The `createWarehouses` function now includes a conditional check to determine whether to use individual or batch creation. If more than one warehouse is requested (`warehouseCount > 1`), batch creation is utilized.
  - In batch mode, `liferay.createWarehousesBatch` is invoked.
  - The existing individual WebSocket emissions for warehouse creation have been made conditional, so they only trigger during individual creation, avoiding redundancy when native batch processing is active.
- **Real-time UI Updates:** This implementation allows the UI to display accurate, real-time progress for multiple warehouse creations leveraging Liferay's native batch processing capabilities.

### Recent Reliability Improvements

- **Data Generation Fixes:**
  - **Robust Option Category Creation:** The logic for creating and reusing option categories has been centralized and made more robust, preventing cascading API errors that could previously halt product specification generation.
  - Fixed a bug that caused a `400 BAD_REQUEST` error (`optionCategory.title must not be null`) when creating product specifications.
  - Resolved an error that occurred when creating price lists due to a missing `catalogId`.
- **Deletion Process Enhancements:**
  - **Resilience:** The "Delete All Commerce Data" operation is now more resilient. It no longer halts if it encounters an entity type that has already been deleted; it now logs the event and continues the process.
  - **Error Reporting:** When a deletion batch fails, the system now retrieves a detailed error report from Liferay and sends it to the user through a WebSocket message, allowing for better debugging and visibility into the failure.

- **Warehouse Generation Session Fix:**
  - The warehouse generation process has been updated to be part of the main generation session. This ensures that its completion is properly tracked and reflected in the UI.

- **Delete Process Improvements:**
  - **Warehouse Deletion:** Warehouses are now deleted individually by iterating through their IDs. This is because there is no batch delete endpoint available for warehouses in the Liferay API.
  - **Corrected Selective Deletion:** The "Selective Delete" functionality has been fixed to prevent the accidental deletion of all specifications, options, and option categories. The process now correctly identifies and deletes only the entities related to the deleted products.

### Export/Import Commerce Data

### Recent Improvements

This version includes several critical reliability improvements and bug fixes:

- **Account Address Generation:** The generation of accounts in demo mode has been improved to correctly create and associate multiple address types. Accounts will now have a "Head Office" contact address, as well as separate, default billing and shipping addresses.
- **Product Deletion Reliability:** The "Delete All" operation has been fixed to ensure products are reliably deleted on the first attempt, resolving an issue where the underlying function was not fully implemented.
- **Demo Data Generation:** Addressed bugs in demo mode to ensure that:
  - Product options (e.g., color, size) are now correctly linked to newly created products.
  - Newly created accounts now include a mock postal address.
- **Robust Price List Handling:**
  - **Deletion Reliability:** Fixed an issue where system-required price lists (e.g., "Master Base Price List") were unintentionally targeted for deletion, causing failures in the chained deletion process. The system now correctly identifies and excludes these protected lists.
  - **Catalog Association:** Corrected the process of associating price lists with catalogs. Previously, attempts to link a price list resulted in an error due to an incorrect API call targeting channels instead of catalogs. Price lists are now correctly linked to their respective catalogs via the Price List API.
  - **Race Condition Mitigation:** Introduced a short delay during price list creation to prevent race conditions that led to `404 NOT_FOUND` errors when immediately adding price entries. This ensures price lists are fully persisted before subsequent operations.
- **Enhanced Deletion Process:**
  - **Accurate Error Reporting:** Improved the batch deletion callback mechanism to ensure the correct entity type is identified even during recovery from failures. This prevents "unknown" entity type errors in logs and provides more accurate error reporting to the frontend.

A new feature has been added to allow users to export generated commerce data to a JSON file and import it back into the application.

## WebSocket Event Contract

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
- **`COMPLETED` (step)**: Marks the `entityType` as 100% complete (setting completed equal to total).
- **`FAILED`**: Propagates errors to the `ADD_ERRORS` action for UI display.
