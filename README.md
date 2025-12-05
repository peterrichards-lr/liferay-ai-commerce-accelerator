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