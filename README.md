# Liferay AI Commerce Accelerator

The Liferay AI Commerce Accelerator is a workspace project designed to rapidly generate and deploy sample commerce data (products, accounts, orders) into a Liferay DXP instance using generative AI. It consists of several interconnected client extensions that provide a user interface for configuration, a microservice for application logic, and batch processes for data loading.

## Components

The accelerator is composed of four main parts that work together:

1.  **Configuration UI (`ai-commerce-accelerator-configuration`)**: A React-based client extension that provides a user interface within the Liferay application menu. Administrators use this UI to configure AI provider settings, API keys, and the content of AI prompts and schemas. All panels now feature a consistent user experience, including "warn on unsaved changes" and "save with Ctrl/Cmd+S" functionality. Frontend components throughout the UI now display icons with correct spacing and alignment.

2.  **Frontend (`ai-commerce-accelerator-frontend`)**: The main user-facing client extension, also based on React. This application allows users to specify the quantity and type of commerce data to generate, monitor the generation process in real-time, and manage the generated data.

3.  **Microservice (`ai-commerce-accelerator-microservice`)**: A Node.js Express server that acts as the brain of the accelerator. It receives requests from the frontend, communicates with the AI service to generate data, and then uses Liferay's Headless APIs to create the commerce data in DXP.

4.  **Batch Loader (`ai-commerce-accelerator-batch`)**: This client extension contains the initial, default data for the AI prompts and schemas. It uses Liferay's Batch Engine to load this configuration into Liferay's object storage.

### Configurable Categories

The available product categories are now dynamically configurable via the "AI Commerce Accelerator Configuration" UI. The categories are stored as a Liferay Object and can be managed through a dedicated panel, allowing administrators to easily update the product catalog without code changes.

## Features

### AI Model Options Configuration

The AI Model Options (which define the available AI models for generation) have been integrated directly into the "AI Configuration" screen within the `ai-commerce-accelerator-configuration` client extension.

-   **Consolidated UI:** The separate "AI Model Options" panel has been removed and its functionality merged into `AiConfigPanel.jsx`. This provides a single, centralized location for managing AI-related settings.
-   **Dynamic Validation:** The validation logic for AI model selection in the microservice's generation operations (`/api/generate/accounts`, `/api/generate/products`, `/api/generate/orders`) is now dynamic. Instead of hardcoded model lists, validation rules are generated at runtime based on the AI model options configured in Liferay.
-   **Default Model Pre-selection:** The microservice's `/api/config/ai-model-options` endpoint now returns the `defaultModel` from the `ai-config` settings, ensuring the frontend UI can correctly pre-select the appropriate AI model in dropdowns. A fallback mechanism ensures that if the configured default model is not found in the available options, the first available model is used as the default.
-   **Frontend UI Fix:** The AI Model dropdown in the frontend (`AdvancedPanel.jsx`) now correctly populates its values from the list returned by the microservice and pre-selects the default model. It also remains disabled until a connection to the microservice is established.

### WebSocket Initialization Refactor

The singleton pattern implemented via `wsBus.cjs` for managing the WebSocket instance proved problematic due to subtle timing and module loading issues in the Node.js environment, leading to persistent "WS not initialized" errors. To resolve this, the singleton pattern has been rolled back, and the WebSocket instance (`ws`) is now explicitly passed between relevant modules.

-   **`wsBus.cjs` Removed:** The `client-extensions/ai-commerce-accelerator-microservice/services/wsBus.cjs` file has been deleted.
-   **Explicit `ws` Instantiation:** In `server.cjs`, the WebSocket instance is now directly created using `createWebSocketService` from `webSocketService.cjs` and assigned to a local `ws` variable.
-   **Explicit `ws` Passing:** The `ws` instance is now explicitly passed as an argument:
    *   From `server.cjs` to `bootstrap.cjs`.
    *   From `bootstrap.cjs` to relevant services and contexts (e.g., `BatchPollingService`, `entityGeneratorCtx`).
    *   From `server.cjs` (via local `ws` or passed down) to route handlers (e.g., `routes/generate.cjs`, `routes/batch.cjs`).
-   **Direct `emit` Calls:** Route handlers and service functions now directly use the passed `ws` instance (e.g., `getWs().emitError(...)`) instead of relying on a singleton `get()` method.

This ensures the WebSocket instance is always explicitly available and correctly initialized throughout its lifecycle, resolving the "WS not initialized" errors and restoring real-time communication functionality.

### AI Model Options Configuration

The AI Model Options (which define the available AI models for generation) have been integrated directly into the "AI Configuration" screen within the `ai-commerce-accelerator-configuration` client extension.

-   **Consolidated UI:** The separate "AI Model Options" panel has been removed and its functionality merged into `AiConfigPanel.jsx`. This provides a single, centralized location for managing AI-related settings.
-   **Dynamic Validation:** The validation logic for AI model selection in the microservice's generation operations (`/api/generate/accounts`, `/api/generate/products`, `/api/generate/orders`) is now dynamic. Instead of hardcoded model lists, validation rules are generated at runtime based on the AI model options configured in Liferay.
-   **Default Model Pre-selection:** The microservice's `/api/config/ai-model-options` endpoint now returns the `defaultModel` from the `ai-config` settings, ensuring the frontend UI can correctly pre-select the appropriate AI model in dropdowns. A fallback mechanism ensures that if the configured default model is not found in the available options, the first available model is used as the default.
-   **Frontend UI Fix:** The AI Model dropdown in the frontend (`AdvancedPanel.jsx`) now correctly populates its values from the list returned by the microservice and pre-selects the default model. It also remains disabled until a connection to the microservice is established.

### WebSocket Initialization Refactor

The singleton pattern implemented via `wsBus.cjs` for managing the WebSocket instance proved problematic due to subtle timing and module loading issues in the Node.js environment, leading to persistent "WS not initialized" errors. To resolve this, the singleton pattern has been rolled back, and the WebSocket instance (`ws`) is now explicitly passed between relevant modules.

-   **`wsBus.cjs` Removed:** The `client-extensions/ai-commerce-accelerator-microservice/services/wsBus.cjs` file has been deleted.
-   **Explicit `ws` Instantiation:** In `server.cjs`, the WebSocket instance is now directly created using `createWebSocketService` from `webSocketService.cjs` and assigned to a local `ws` variable.
-   **Explicit `ws` Passing:** The `ws` instance is now explicitly passed as an argument:
    *   From `server.cjs` to `bootstrap.cjs` (which is now a function that accepts `ws`).
    *   From `bootstrap.cjs` to relevant services and contexts (e.g., `BatchPollingService`, `entityGeneratorCtx`) via their constructors or context objects.
    *   From `server.cjs` to route handlers (e.g., `routes/generate.cjs`, `routes/batch.cjs`) via their `module.exports` arguments.
-   **Direct `emit` Calls:** Route handlers and service functions now directly use the passed `ws` instance (e.g., `getWs().emitError(...)`) instead of relying on a singleton `get()` method.

This ensures the WebSocket instance is always explicitly available and correctly initialized throughout its lifecycle, resolving the "WS not initialized" errors and restoring real-time communication functionality.

### WebSocket Initialization Refactor

The previous singleton pattern implemented via `wsBus.cjs` for managing the WebSocket instance proved problematic due to subtle timing and module loading issues in the Node.js environment, leading to persistent "WS not initialized" errors. To resolve this, the singleton pattern has been rolled back, and the WebSocket instance (`ws`) is now explicitly passed between relevant modules.

-   **`wsBus.cjs` Removed:** The `client-extensions/ai-commerce-accelerator-microservice/services/wsBus.cjs` file has been deleted.
-   **Explicit `ws` Instantiation:** In `server.cjs`, the WebSocket instance is now directly created using `createWebSocketService` from `webSocketService.cjs` and assigned to a local `ws` variable.
-   **Explicit `ws` Passing:** The `ws` instance is now explicitly passed as an argument:
    *   From `server.cjs` to `bootstrap.cjs` (which is now a function that accepts `ws`).
    *   From `bootstrap.cjs` to relevant services and contexts (e.g., `BatchPollingService`, `entityGeneratorCtx`) via their constructors or context objects.
    *   From `server.cjs` to route handlers (e.g., `routes/generate.cjs`, `routes/batch.cjs`) via their `module.exports` arguments.
-   **Direct `emit` Calls:** Route handlers and service functions now directly use the passed `ws` instance (e.g., `getWs().emitError(...)`) instead of relying on a singleton `get()` method.

This ensures the WebSocket instance is always explicitly available and correctly initialized throughout its lifecycle, resolving the "WS not initialized" errors and restoring real-time communication functionality.

### AI Model Options Configuration

The AI Model Options (which define the available AI models for generation) have been integrated directly into the "AI Configuration" screen within the `ai-commerce-accelerator-configuration` client extension.

-   **Consolidated UI:** The separate "AI Model Options" panel has been removed and its functionality merged into `AiConfigPanel.jsx`. This provides a single, centralized location for managing AI-related settings.
-   **Dynamic Validation:** The validation logic for AI model selection in the microservice's generation operations (`/api/generate/accounts`, `/api/generate/products`, `/api/generate/orders`) is now dynamic. Instead of hardcoded model lists, validation rules are generated at runtime based on the AI model options configured in Liferay.
-   **Default Model Pre-selection:** The microservice's `/api/config/ai-model-options` endpoint now returns the `defaultModel` from the `ai-config` settings, ensuring the frontend UI can correctly pre-select the appropriate AI model in dropdowns. A fallback mechanism ensures that if the configured default model is not found in the available options, the first available model is used as the default.
-   **Frontend UI Fix:** The AI Model dropdown in the frontend (`AdvancedPanel.jsx`) now correctly populates its values from the list returned by the microservice and pre-selects the default model. It also remains disabled until a connection to the microservice is established.

### WebSocket Initialization Refactor

The previous singleton pattern implemented via `wsBus.cjs` for managing the WebSocket instance proved problematic due to subtle timing and module loading issues in the Node.js environment, leading to persistent "WS not initialized" errors. To resolve this, the singleton pattern has been rolled back, and the WebSocket instance (`ws`) is now explicitly passed between relevant modules.

-   **`wsBus.cjs` Removed:** The `client-extensions/ai-commerce-accelerator-microservice/services/wsBus.cjs` file has been deleted.
-   **Explicit `ws` Instantiation:** In `server.cjs`, the WebSocket instance is now directly created using `createWebSocketService` from `webSocketService.cjs` and assigned to a local `ws` variable.
-   **Explicit `ws` Passing:** The `ws` instance is now explicitly passed as an argument:
    *   From `server.cjs` to `bootstrap.cjs` (which is now a function that accepts `ws`).
    *   From `bootstrap.cjs` to relevant services and contexts (e.g., `BatchPollingService`, `entityGeneratorCtx`) via their constructors or context objects.
    *   From `server.cjs` to route handlers (e.g., `routes/generate.cjs`, `routes/batch.cjs`) via their `module.exports` arguments.
-   **Direct `emit` Calls:** Route handlers and service functions now directly use the passed `ws` instance (e.g., `getWs().emitError(...)`) instead of relying on a singleton `get()` method.

This ensures the WebSocket instance is always explicitly available and correctly initialized throughout its lifecycle, resolving the "WS not initialized" errors and restoring real-time communication functionality.

### Batch Error `correlationId` Retrieval Fix

Previously, `BATCH_ERROR_DETAILS` WebSocket events were sometimes emitted with an `unknown` or `undefined` `correlationId`, causing the frontend to miss these important error notifications. The `correlationId` is crucial for the frontend to associate an error with a specific generation session.

-   **Robust `correlationId` Retrieval:** The `batchPollingService.cjs` has been updated to more robustly determine the `correlationId` when emitting `BATCH_ERROR_DETAILS` events. The logic now prioritizes retrieving the `correlationId` from:
    1.  The `batch:${batchId}:submission` data in the cache (which stores the original submission details).
    2.  The `pollData` associated with the active polling session.
    3.  The `batchConfig` retrieved for the batch.
    4.  The `batch:${batchId}:config` entry in the cache.
    5.  The ERC-based config (e.g., `erc:${batchConfig.externalReferenceCode}:config`) if available.

This ensures that `BATCH_ERROR_DETAILS` events are always emitted with the correct `correlationId`, allowing the frontend to properly filter and display errors relevant to the current user session.

### Warehouse & Inventory Generation

The accelerator now supports the creation of warehouses and the distribution of inventory across them.

- **Automated Warehouse Creation**: When generating products, you can now opt to create a specified number of warehouses.
- **Inventory Distribution**: The inventory for each generated product SKU is automatically distributed among the available warehouses.
- **Reuse Existing Warehouses**: To avoid creating duplicate warehouses, you can choose to reuse existing warehouses if they are found in the Liferay instance.

### Export/Import Commerce Data

You can now export the generated commerce data to a JSON file and import it back into the accelerator at a later time. This is useful for saving a set of generated data to be reused without needing to regenerate it from scratch.

- **Export Data**: After a data generation process is complete, you can export all generated products, accounts, and orders to a single JSON file.
- **Import Data**: You can upload a previously exported JSON file to recreate the commerce data in your Liferay instance. This uses the same batch processing engine as the regular data generation, ensuring a reliable import process.

### Data Flow & Dependencies

-   The **Frontend** talks exclusively to the **Microservice**.
-   The **Microservice** reads its configuration (prompts, schemas, API keys) from Liferay Objects, which are managed by the **Configuration UI**.
-   The **Batch Loader** provides the default prompts and schemas that are loaded into Liferay when the solution is first deployed.

## Automated Batch File Generation

To simplify development and ensure consistency, the batch files for the default AI prompts and schemas are **automatically generated** by the Gradle build.

-   **Single Source of Truth:** The `*.json` files in `client-extensions/ai-commerce-accelerator-microservice/ai-schemas/` for schemas, the `*.md` files in `client-extensions/ai-commerce-accelerator-microservice/prompts/` for prompts, and `client-extensions/ai-commerce-accelerator-frontend/src/config/categories.json` for product categories are the canonical sources for this configuration.
-   **How it Works:** When you run the build, a Gradle task (`generateBatchFiles`) reads the contents of these directories, wraps them in the required Liferay Batch Engine JSON format, and places the generated files into the `client-extensions/ai-commerce-accelerator-batch/batch/` directory. The generated files are given a numeric prefix to control the import order, which is determined by an alphabetical sort of the source filenames to ensure consistent sequencing of generated batch files.

You only need to modify the source `.json` (schema) and `.md` (prompt) files in the microservice directory; the build process will handle the rest.

## Setup and Deployment

### Prerequisites

-   Liferay DXP 7.4 GA 95+ or Liferay Portal 7.4 GA 95+
-   Java 11
-   Node.js (LTS version)
-   `blade` CLI

### Installation

1.  **Configure Liferay Connection:**
    -   In the project root, create a `gradle.properties` file if it doesn't exist.
    -   Add the following property to point to your Liferay bundle's directory:
        ```properties
        liferay.home=/path/to/your/liferay/bundle
        ```

2.  **Deploy All Client Extensions:**
    -   Open a terminal in the project root.
    -   Run the following Gradle command. This will build all components (including the automated batch file generation) and deploy them to your Liferay instance.
        ```bash
        blade gw clean deploy
        ```

## Usage

1.  **Configure the Application:**
    -   Once deployed, navigate to your Liferay instance.
    -   Go to the **Global Menu** → **Applications** → **AI Commerce Accelerator Configuration**.
    -   In this screen, configure your AI provider (e.g., OpenAI API Key), review the AI prompts and schemas, and save your settings. All panels now feature a consistent user experience, including "warn on unsaved changes" and "save with Ctrl/Cmd+S" functionality. Frontend components throughout the UI now display icons with correct spacing and alignment. All panels now feature a consistent user experience, including "warn on unsaved changes" and "save with Ctrl/Cmd+S" functionality. Frontend components throughout the UI now display icons with correct spacing and alignment.

2.  **Generate Data:**
    -   Add the **AI Commerce Accelerator** widget to a page from the Page Editor.
    -   Use the interface to test your connection to the Liferay and microservice endpoints.
    -   Select the quantity and type of data (products, accounts, orders) you wish to generate.
    -   Click "Start Generation" and monitor the progress in the dashboard.
    -   If a batch process fails, detailed error information will now be displayed in the dashboard to help diagnose the issue.
    -   Once generation is complete, you can use the "Export Data" button to save the generated data.
    -   At any time, you can use the "Import Data" button to upload a previously exported data file.

## Local Development

For more advanced development, you can run the frontend and microservice locally.

### Frontend (Standalone)

This allows you to work on the UI with hot-reloading. The app will run in "standalone" mode, showing extra input fields for configuration that are normally provided by Liferay.

```bash
(cd ./client-extensions/ai-commerce-accelerator-frontend && npm run dev)
```

### Microservice (Local)

This command will deploy the microservice and start it in debug mode.

```bash
(rm -f client-extensions/ai-commerce-accelerator-microservice/logs/*.log || true) && blade gw :client-extensions:ai-commerce-accelerator-microservice:clean :client-extensions:ai-commerce-accelerator-microservice:deploy :client-extensions:ai-commerce-accelerator-microservice:packageRunDebug
```