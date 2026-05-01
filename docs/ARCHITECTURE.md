# Architectural Overview

The Liferay AI Commerce Accelerator employs a sophisticated, stateful, and asynchronous architecture to manage the creation of large amounts of commerce data.

## System Map

```mermaid
graph TD
    A[Frontend React App] -->|WebSocket/REST| B[Node.js Microservice]
    B -->|Generative AI API| C[AI Providers (OpenAI, Gemini, etc.)]
    B -->|Headless Batch APIs| D[Liferay DXP]
    D -->|Batch Callbacks| B
    B -->|State Management| E[(SQLite Database)]
    F[Configuration UI] -->|REST| D
```

## Data Generation Workflow

At its core, the system is a state machine orchestrated by `batchCallbackService.cjs`.

- **Stateful Workflow Engine**: Uses a local **SQLite** database (`workflows.db`) to track the state of every generation job. This makes the process resilient to server restarts.
- **Asynchronous Batch Processing**: Designed around the limitations of Liferay's Headless Batch APIs.
  1.  **Stateless Callbacks**: Liferay's batch engine callback does not contain context about the original request.
  2.  **`batchERC` for Correlation**: The microservice generates a unique identifier (`batchERC`) for each batch. This ERC is appended to the callback URL.
  3.  **State Lookup**: When Liferay calls the callback endpoint, the service uses the `batchERC` to resume the correct workflow.

### Entity Dependencies

When creating entities with parent-child relationships (like Accounts and their Addresses), the workflow follows a multi-step process:

1.  Submit a batch to create parent entities.
2.  Wait for completion.
3.  Fetch new parent entities to retrieve system-generated IDs.
4.  Submit a new batch for child entities with the necessary parent IDs.

### Batch Statuses

- **`PREPARED`**: Created in local DB, not yet submitted to Liferay.
- **`SUBMITTED`**: Sent to Liferay, waiting for callback.
- **`COMPLETED`**: Liferay finished processing with no errors.
- **`FAILED`**: Liferay encountered an error.
- **`BYPASSED`**: Step skipped due to logic or configuration.
- **`SYNCHRONOUS`**: Internal microservice logic or synchronous API calls.

## WebSocket Event Contract

The microservice and frontend communicate using a hierarchical **Scope/Status** model.

### Event Structure (JSON)

```json
{
  "type": "STARTED | PROGRESS | COMPLETED | FAILED",
  "scope": "session | step | batch",
  "entityType": "products | accounts | orders | warehouses | images | pdfs",
  "operation": "generate | delete | process-images | process-attachments",
  "processedCount": 50,
  "totalCount": 100,
  "correlationId": "CID-789"
}
```

### Critical Sync Rule

Any change to the event emission logic in `ProgressService.cjs` MUST be matched by a corresponding update in the frontend `progressReducer.js`.
