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
