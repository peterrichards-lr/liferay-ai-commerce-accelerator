# Gemini Context

This file contains context for Gemini to refer to in future interactions.

## Project Overview

This is a Liferay workspace project for the Liferay AI Commerce Accelerator. It includes a combination of Liferay fragments, client extensions, and a Node.js microservice.

### Technologies Used

*   **Backend**: Java (Liferay), Node.js (Microservice)
*   **Frontend**: React, Liferay Fragments
*   **Build Tools**: Gradle, npm/yarn

### Project Structure

*   `build.gradle`: Main Gradle build file.
*   `client-extensions/`: Contains client-side extensions.
    *   `ai-commerce-accelerator-batch/`: Batch engine data for Liferay.
    *   `ai-commerce-accelerator-configuration/`: React-based configuration client extension.
    *   `ai-commerce-accelerator-frontend/`: The main React-based frontend client extension.
    *   `ai-commerce-accelerator-microservice/`: A Node.js microservice.
*   `configs/`: Environment-specific configurations.
*   `fragments/`: Liferay fragments.
*   `gradle/`: Gradle wrapper files.
*   `resources/`: Static resources like PDF and image files.

### Development

*   **Frontend (Standalone)**: Run `(cd ./client-extensions/ai-commerce-accelerator-frontend && npm run dev)` for local development. When running standalone, the UI will show additional input fields for values that are normally retrieved from the Liferay environment.
*   **Deploy Client Extensions**: `blade gw clean deploy`
*   **Microservice**: Use Gradle tasks for deployment and debugging: `(rm -f client-extensions/ai-commerce-accelerator-microservice/logs/*.log || true) && blade gw :client-extensions:ai-commerce-accelerator-microservice:clean :client-extensions:ai-commerce-accelerator-microservice:deploy :client-extensions:ai-commerce-accelerator-microservice:packageRunDebug`
*   **Liferay**: Use `blade gw initBundle`, `blade gw deploy`, and `blade server run` to run Liferay locally.

### Frontend Notes

The frontend client extension is hosted in Liferay as a custom element. The UI code determines whether it's running within Liferay and adjusts the displayed input fields accordingly.

### Dependencies

#### Frontend (`ai-commerce-accelerator-frontend`)

*   `@clayui/card`
*   `@clayui/form`
*   `@clayui/button`
*   `@clayui/panel`
*   `@vitejs/plugin-react`
*   `react`
*   `react-dom`

#### Microservice (`ai-commerce-accelerator-microservice`)

*   `@google-cloud/storage`
*   `@rotty3000/config-node`
*   `axios`
*   `cors`
*   `express`
*   `form-data`
*   `jsonwebtoken`
*   `jspdf`
*   `jwk-to-pem`
*   `memory-cache`
*   `multer`
*   `node-fetch`
*   `openai`
*   `uuid`
*   `ws`

## Deletion Order for Commerce Data

The microservice provides multiple endpoints for deleting commerce data:

1.  `/api/v2/delete-commerce-data`: This is the recommended endpoint for deleting **ALL** commerce data. It uses a modern, callback-driven approach that is more reliable and avoids server timeouts.
2.  `/api/delete-commerce-data`: This is a legacy endpoint that also deletes **ALL** commerce data. It uses an older, long-polling mechanism and is kept for backward compatibility.
3.  `/api/delete-channel-commerce-data`: This operation deletes commerce data associated with a specific channel and catalog.
    *   It requires a `channelId` to delete associated orders and accounts.
    *   It requires a `catalogId` to delete associated products.

When deleting commerce data, the following dependencies must be respected, and entities should be deleted in this order:

1.  **Orders**: Must be deleted first.
2.  **Accounts**: Can be deleted after Orders.
3.  **Products**: Can be deleted after Orders.
4.  **Specifications (Specification Labels)**: Can be deleted after Products.
5.  **Options and Option Categories**: Can be deleted after Specifications.

The deletion process for `/api/v2/delete-commerce-data` uses a robust, callback-driven approach to prevent server timeouts and improve reliability.

*   The process is initiated by `runDeleteAndMonitorV2` in `deleteCoordinatorService.cjs`.
*   It starts by deleting the first entity type (Orders) and provides a `/api/batch/callback` URL to Liferay.
*   Upon completion of a batch, Liferay calls this endpoint, which then triggers the deletion of the next entity type in the sequence (Accounts, then Products, etc.).
*   This creates a reliable chain of operations that continues in the background without requiring a long-running request from the client.
*   The old polling-based implementation (`runDeleteAndMonitor`) is available via the legacy `/api/delete-commerce-data` endpoint.