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

------------------------------------------------------------------------

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

------------------------------------------------------------------------

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

### Gradle build customisations

The Liferay workspace includes Gradle customisations that support building Client Extension artefacts from shared JSON sources.

#### Batch JSON generation
- The microservice owns the canonical JSON definitions used to drive batch operations.
- The Gradle build is customised so that the Batch Client Extension JSON artefacts are generated or assembled from the same JSON sources used by the microservice.
- This ensures a single source of truth for batch payload structure and avoids drift between the microservice and the Batch CX.

Implementation expectations:
- Gradle tasks must treat the microservice JSON as input and produce the Batch CX JSON output as build artefacts.
- The build must fail fast when the source JSON is invalid or missing.
- Generated artefacts must be reproducible and deterministic.

#### Frontend UI integration via Liferay Fragment wrapper
- The UI is embedded into Liferay using a Fragment wrapper.
- The Fragment wrapper must load and apply the CSS from the Frontend UI Client Extension so that the UI renders consistently inside Liferay pages and admin surfaces.
- The Fragment wrapper must avoid duplicating styles and must not introduce conflicting global CSS.

Implementation expectations:
- The fragment must reference the same CSS assets produced by the Frontend UI build.
- The fragment must remain minimal and act only as a host/container for the UI.
- The microservice remains the runtime orchestrator; the fragment is presentation-only.

### Liferay API Specifications

The microservice communicates with Liferay using both REST and GraphQL APIs. The schemas for these APIs are stored locally and serve as the authoritative reference for all interactions.

#### REST APIs (OpenAPI)
- **Location**: `client-extensions/ai-commerce-accelerator-microservice/api-schemas/`
- **Format**: OpenAPI (JSON)
- **Purpose**: These specifications define the request and response shapes for all Liferay Headless REST APIs used by the microservice. They are the source of truth for REST client generation, request validation, and API usage analysis.
- **Validation Mandate**: All REST API endpoints and path parameters MUST be validated against these schema files. A task is NOT considered complete until all implemented or modified API calls have been verified to match the paths and methods defined in the authoritative OpenAPI reference.

#### GraphQL API
- **Location**: `client-extensions/ai-commerce-accelerator-microservice/api-schemas/liferay_schema.graphql`
- **Format**: GraphQL Schema Definition Language (SDL)
- **Purpose**: This schema defines the types, queries, and mutations available through Liferay's Headless GraphQL API. It is used for crafting GraphQL queries and understanding the available data graph.
- **Validation Mandate**: All GraphQL queries MUST be validated against this schema file. A task is NOT considered complete until all implemented or modified queries have been verified to match the available types and fields in this authoritative reference.

### GraphQL Query Validation
To ensure reliability and prevent runtime errors (e.g., requesting non-existent fields), every developer and AI agent must perform a manual or automated check of every GraphQL query against the local `liferay_schema.graphql` file. Specifically:
1.  **Field Existence**: Verify that every field requested in a selection set exists on the corresponding type in the schema.
2.  **Namespace Verification**: Ensure the top-level query namespace (e.g., `headlessCommerceAdminOrder_v1_0`) is present and correctly spelled.
3.  **Argument Validation**: Confirm that all arguments passed to query methods match the schema's definitions.
4.  **Definition of Done**: Verification against the local schema is a mandatory step in the "Definition of Done" for any task involving GraphQL.

### Batch Engine Verb Support (Unusual Behavior)
- **Constraint**: Not all Liferay Batch Engine endpoints support the HTTP `DELETE` verb.
- **Example**: The `/warehouses/batch` endpoint only supports `POST` (for creation/update). Attempting a `DELETE` request will result in a `404 Not Found` error.
- **Resolution**: For entity types that lack native batch deletion support, use **Simulated Batching** (sequential individual `DELETE` requests) instead of relying on the Batch Engine. Always verify the supported verbs in the OpenAPI schema (`api-schemas/*.json`) before implementing a deletion step.

------------------------------------------------------------------------

## OData Filtering & API Constraints

To ensure maximum compatibility across Liferay's diverse Headless API implementations, the following OData and filtering patterns must be strictly followed:

### 1. OData Operator Reference
While Liferay supports a broad range of OData operators, **implementation is inconsistent** across different entities and API versions. 

| Operator | Description | Example |
| :--- | :--- | :--- |
| `eq` | Equal | `addressLocality eq 'Redmond'` |
| `eq` | Equal null | `addressLocality eq null` |
| `ne` | Not equal | `addressLocality ne 'London'` |
| `ne` | Not null | `addressLocality ne null` |
| `gt` | Greater than | `price gt 20` |
| `ge` | Greater than or equal | `price ge 10` |
| `lt` | Less than | `dateCreated lt 2018-02-13T12:33:12Z` |
| `le` | Less than or equal | `dateCreated le 2012-05-29T09:13:28Z` |
| **Logical** | | |
| `and` | Logical and | `price le 200 and price gt 3.5` |
| `or` | Logical or | `price le 3.5 or price gt 200` |
| `not` | Logical not | `not (price le 3.5)` (Note: trailing space required) |
| **Grouping** | | |
| `( )` | Precedence grouping | `(price eq 5) or (addressLocality eq 'London')` |
| **String Functions** | | |
| `contains()` | Contains | `contains(title, 'edmon')` |
| `startswith()` | Starts with | `startswith(addressLocality, 'Lond')` |
| **String (Shorthand)** | | |
| `sw` | Starts with | `externalReferenceCode sw 'AICA-'` |
| **Lambda Operators** | | |
| `any` | Any | `keywords/any(k:contains(k,'news'))` |

### 2. Implementation Caveats & Mandatory Patterns
- **Operator Preference (`sw` vs `startswith`)**: Always use the shorthand `sw` operator instead of the functional `startswith()` for prefix filtering. Functional notation often triggers `400 Bad Request` on newer entities (e.g., Pricing V2.0, Catalog V1.0).
- **Pricing V2.0 Domain Restrictions**: Both REST and GraphQL Price List/Promotion endpoints have extremely limited OData support. 
    - **Forbidden Filters**: Do not attempt to filter by `type`, `catalogId`, or boolean flags like `catalogBasePriceList` via OData. These frequently cause `Collection not allowed` or `DataFetchingException: null`.
    - **Discovery Strategy**: Retrieve items using only simple filters (or no filter) and perform all logic-heavy evaluation (casing, complex properties) in **JavaScript memory**.
- **Enum Comparison Robustness**: Casing and formatting of Enum values vary. Always normalize strings (lowercase + remove hyphens/underscores) before comparison in JavaScript.
- **Regional Metadata Fallbacks**: Liferay's Headless API for Addresses strictly validates the `addressRegion` field. Providing placeholder strings like `N/A` will result in a `400 Bad Request`. Always provide `null` if a region cannot be determined.

### 3. Documentation Reference
For the most up-to-date information on Liferay's OData implementation, refer to the official [Headless API Query Parameters](https://learn.liferay.com/w/dxp/integration/headless-apis/using-liferay-as-a-headless-platform/consuming-apis/api-query-parameters) documentation.

------------------------------------------------------------------------

## GraphQL Discovery Pattern

To ensure high reliability and performance when using Liferay's Headless GraphQL API, follow these established patterns:

### 1. Preference for Data Retrieval
- **Usage Recommendation**: Prefer GraphQL over REST for all data retrieval operations (GET requests).
- **Rationale**: Provides granular control over the returned schema, minimizes payload size, and allows for efficient retrieval of related data in a single round-trip.

### 2. Aliased Queries for Multi-Item Fetching
- **Mandatory Pattern**: When fetching multiple individual items by a unique key (like `externalReferenceCode`), use **Aliased Queries** to batch them into a single request.
- **Example**:
  ```graphql
  query {
    headlessCommerceAdminCatalog_v1_0 {
      a0: productByExternalReferenceCode(externalReferenceCode: "ERC-1") { id name }
      a1: productByExternalReferenceCode(externalReferenceCode: "ERC-2") { id name }
    }
  }
  ```
- **Rationale**: Significantly more efficient than making multiple individual GraphQL queries or a single filtered query when dealing with many specific IDs.

### 3. Variable-Based Queries
- **Mandatory Pattern**: Always use GraphQL variables for dynamic values (like `filter`, `externalReferenceCode`, or `id`). Never use template literal interpolation for variable values inside the query string.
- **Rationale**: Improves security, makes logs more readable, and allows Liferay to cache the query structure more efficiently.

### 4. Resilient STALE_INDEX Handling
- **Constraint**: Liferay's Search Index is asynchronous. Entities created via Batch Engine may not be immediately visible to GraphQL queries.
- **Actionable Pattern**: Implement an automatic retry mechanism with **Exponential Backoff** (e.g., 10 attempts starting at 2s).
- **Trigger**: Any `DataFetchingException` or `null` result for an expected entity should be interpreted as a potential `STALE_INDEX` and trigger a retry.

### 5. Error Level Demotion
- **Pattern**: Common errors indicating a missing entity (e.g., `DataFetchingException`, `NOT_FOUND`) should be logged at the `DEBUG` level rather than `ERROR`.
- **Rationale**: These are common and expected conditions during rapid data generation and shouldn't clutter the production error logs.

### 6. Prefer for Nested Data
- **Usage Recommendation**: Prefer GraphQL over REST when fetching multiple related levels (e.g., `Product` -> `Skus` -> `OptionValues`). 
- **Rationale**: Significantly reduces the number of round-trips to the server compared to multiple REST calls.

------------------------------------------------------------------------

## Liferay API Best Practices

The following patterns are derived from Liferay's official documentation and ensure long-term compatibility:

### 1. Authentication & Headers
- **Production Standard**: Always use **OAuth2** (`Authorization: Bearer <token>`) for all REST and GraphQL requests.
- **Content Type**: `application/json` is mandatory for all `POST`, `PUT`, and `PATCH` operations.
- **Localization**: Use the `Accept-Language` header to request localized content or specify the language for the response.

### 2. GraphQL Namespacing
- **Constraint**: Newer Liferay versions require versioned namespaces (e.g., `headlessDelivery_v1_0 { ... }`) to avoid naming conflicts. 
- **Mandatory Pattern**: Always wrap GraphQL queries and mutations within the appropriate versioned namespace. Non-namespaced APIs are deprecated.

### 3. Site Identification Resolution
- **Constraint**: From 2025.Q3+, endpoints accepting `{siteId}` also accept the **Site Key** or **External Reference Code**.
- **Resolution Priority**: If values conflict, Liferay resolves them in this order:
    1.  **Site Key** (Highest)
    2.  **Site ID**
    3.  **External Reference Code** (Lowest)
- **Actionable Pattern**: In GraphQL, use the `siteKey` argument where REST would use a `siteId` path parameter.

### 4. HATEOAS & Actions
- **Feature**: REST responses include an `actions` block containing URLs and methods for permitted operations (e.g., `update`, `delete`).
- **Usage Recommendation**: Inspect the `actions` block to dynamically determine if an operation is available for the current user/entity state.

------------------------------------------------------------------------

## Storage strategy

### Guiding principle

**Workflow execution state must not depend on Liferay availability or
Headless API latency.**

### Hybrid Persistence Model

The microservice employs two distinct storage layers to balance resilience, performance, and data isolation.

#### 1. Workflow Persistence Layer (`PersistenceService`)
This layer manages the canonical state of all asynchronous operations (sessions, batches, and events).

-   **Primary Store (Source of Truth):**
    -   A file-based **SQLite** database (`workflows.db`).
    -   **Durability**: Preserved across process restarts, enabling session resumption and reliable audit trails.
    -   **Schema**: Includes `workflow_sessions`, `workflow_batches`, and `workflow_events`.
-   **Read-Through Cache:**
    -   An in-memory cache (`memory-cache`) sits in front of the database to reduce disk I/O for frequent lookups (e.g., status checks).
-   **Consistency Model (Write-Invalidate):**
    -   **Reads**: Checks cache first; on miss, loads from SQLite and populates cache.
    -   **Writes/Updates**: All mutations are written directly to SQLite first. Immediately following a successful write, the corresponding cache entry is **invalidated (deleted)**. This ensures subsequent reads always fetch the latest data from the database.

#### 2. Application Data Cache (`CacheService`)
This layer stores transient metadata, configuration, and intermediate processing results.

-   **Source of Truth**: Remote Liferay Headless APIs or local configuration files.
-   **Mechanism**: A custom `Map`-based implementation with **TTL (Time-To-Live)** and periodic background cleanup.
-   **Scope**:
    -   **Configuration**: Liferay OAuth settings, AI prompts, and schemas.
    -   **Metadata**: Site languages, countries, and regions (to reduce redundant API calls).
    -   **Session Context**: Mapping of batch IDs to individual item ERCs for callback correlation.
-   **Pattern**: Uses a "remember" logic to fetch and cache remote data transparently.

### Liferay Objects (slow path, visibility and configuration)

Use Liferay Objects only for: - configuration managed by
administrators - optional workflow run summaries

Liferay Objects must **not** be used as the primary workflow context
store.

------------------------------------------------------------------------

## Client Extension responsibilities

  -----------------------------------------------------------------------------------
  Component Read Write Notes
  ---------------------- --------------- ----------------- --------------------------
  Frontend UI CX WebSocket None Read-only
                         events                            

  Configuration UI CX Liferay Objects Liferay Objects Admin configuration

  Batch CX Liferay Objects Liferay Objects Structural/configuration
                                                           data

  Microservice Liferay SQLite Single writer for workflow
                         Objects, SQLite state
  -----------------------------------------------------------------------------------

------------------------------------------------------------------------

## Core identifiers

### sessionId

Primary identifier for a workflow run and UI subscription.

### erc

Primary identifier for a batch submission and callback correlation.

### wsCorrelationId

Identifier for correlating WebSocket messages and logs.

### errorRef

Identifier for correlating user-visible errors and server logs.

------------------------------------------------------------------------

## Storage model (microservice)

### workflow_sessions

- session_id
- flow_type
- status
- current_steps (updated to TEXT to store JSON array of active steps)
- context_json
- correlation_id
- version
- created_at
- updated_at

### workflow_batches

- erc
- session_id
- step_key
- status
- downstream_batch_id
- processed_count
- total_count
- error_count
- created_at
- updated_at

------------------------------------------------------------------------

## Step modules

Steps are pure, self-contained units.

### Input

- context

### Output

- patch
- commands
- transition

Steps must not perform I/O.

------------------------------------------------------------------------

## Runner responsibilities

The runner owns: - step execution - persistence - command execution -
resumption after callbacks

------------------------------------------------------------------------

## Batch submission lifecycle

Persist erc before calling downstream services.

------------------------------------------------------------------------

## Callback handling

Callbacks resume workflows using erc as the sole correlation key.

------------------------------------------------------------------------

## Failure inspection

Failed batches trigger a follow-up step that fetches failure details.

------------------------------------------------------------------------

## Recovery and restart semantics

### Restart behavior

- If SQLite is preserved, sessions may resume
- Otherwise sessions are failed with an errorRef

### Late callbacks

- Callbacks referencing unknown erc values are ignored

------------------------------------------------------------------------

## WebSocket messaging

WebSocket messages are notifications derived from persisted state.

------------------------------------------------------------------------

## Progress object

``` json
{
  "scope": "session | step | batch",
  "current": 0,
  "total": 0,
  "percent": 0,
  "phase": "submitting | waiting | processing | postProcessing"
}
```

------------------------------------------------------------------------

## WebSocket event types

Session-level: - session_started - step_started - step_completed -
session_waiting - session_completed - session_failed

Batch-level: - batch_prepared - batch_started - batch_progress -
batch_completed - batch_failed

------------------------------------------------------------------------

## Observability and logging contract

All logs emitted by the microservice must include, when available: -
timestamp - level - sessionId - erc - wsCorrelationId - errorRef

Logs must be structured and machine-readable.

------------------------------------------------------------------------

## Workflow & Batch Statuses

The `status` column in the `workflow_batches` table is critical for orchestrating the workflow and signaling the UI. The possible statuses are:

*   **`PREPARED`**: A batch has been created in the microservice's local database but has not yet been submitted to the Liferay Batch Engine.
*   **`SUBMITTED`**: The batch has been successfully sent to the Liferay Batch Engine and is either queued or is actively being processed.
*   **`COMPLETED`**: Liferay's Batch Engine has finished processing the batch with no errors. This status is critical for the UI's progress bars.
*   **`FAILED`**: Liferay's Batch Engine encountered an error and could not process the batch.
*   **`BYPASSED`**: A step that could have involved a Liferay batch was intentionally skipped due to user configuration, conditional logic, or because the data set was empty. This indicates a "null-op" where a batch was a possibility but wasn't necessary this time.
*   **`SYNCHRONOUS`**: This step in the workflow never involves the Liferay Batch Engine by design. It represents internal microservice logic, data enrichment, or synchronous API calls.

------------------------------------------------------------------------

## Workflow state machine summary

### Session states

- initialized
- running
- waiting
- completed
- failed

Valid transitions: - initialized → running - running → waiting - waiting
→ running - running → completed - running → failed - waiting → failed

### Batch states

- prepared
- submitted
- completed
- failed

Valid transitions: - prepared → submitted - submitted → completed -
submitted → failed

------------------------------------------------------------------------

## Command types and delivery guarantees

### SubmitBatch

- at-least-once
- idempotent via erc

### FetchBatchFailureDetails

- at-least-once
- deterministic overwrite

### EmitWebSocketEvent

- best-effort

### ResumeSession

- at-least-once
- no-op safe

------------------------------------------------------------------------

## Known failure scenarios and expected behaviour

  -----------------------------------------------------------------------
  Scenario Expected behaviour
  -------------------- --------------------------------------------------
  Callback arrives erc already persisted; callback processed safely
  before submit        
  completes            

  Duplicate callback Detected via terminal batch state; ignored

  Callback with Logged and ignored
  unknown erc          

  Partial batch Failed items recorded; workflow continues or fails
  failure based on policy

  Downstream timeout Batch marked failed; errorRef generated

  WebSocket disconnect Workflow continues; UI may reconnect

  Microservice restart Session resumed if SQLite preserved, otherwise
  mid-run failed

  Liferay Headless API Workflow execution continues; Liferay writes
  unavailable deferred or skipped
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## Key invariants

- Only the microservice mutates workflow execution state
- Callbacks are correlated using erc
- Persistence always precedes external side effects
- WebSocket messages reflect persisted state only

------------------------------------------------------------------------

## WebSocket Communication Contract

The Microservice and Frontend UI communicate via WebSockets using a hierarchical **Scope/Status** model to provide real-time feedback. This approach avoids redundant event types by combining a generic lifecycle status with a specific operational scope.

### Lifecycle Statuses

- **`STARTED`**: An operation at the given scope has begun.
- **`PROGRESS`**: Granular update within the current scope (e.g., items processed).
- **`COMPLETED`**: An operation at the given scope has finished successfully.
- **`FAILED`**: An operation at the given scope has encountered an error.

### Operational Scopes

- **`session`**: Global workflow lifecycle (e.g., "Product Generation Flow").
- **`step`**: Logical entity category within a flow (e.g., "Generating Products", "Attaching Images").
- **`batch`**: A single physical submission to the Liferay Batch Engine.

### Standardized Entity Types

The microservice emits specific step keys which the frontend normalizes into these standard categories for UI routing:

| Standard Category | Description | Source Step Keys |
| :--- | :--- | :--- |
| **`products`** | Commerce Products | `products`, `deleteProducts`, `product-data-generation` |
| **`accounts`** | Liferay Accounts | `accounts`, `deleteAccounts`, `postal-addresses` |
| **`orders`** | Commerce Orders | `orders`, `deleteOrders` |
| **`warehouses`** | Inventory Warehouses | `warehouses`, `generate-warehouses`, `deleteWarehouses` |
| **`images`** | Product Images | `attach-images`, `process-images` |
| **`pdfs`** | Product PDFs | `attach-pdfs`, `process-pdfs` |
| **`specifications`** | Product Specifications | `deleteSpecifications`, `deleteProductSpecifications` |
| **`options`** | Product Options | `deleteOptions`, `deleteProductOptions`, `link-product-options` |
| **`price-lists`** | Price Lists & Entries | `deletePriceLists` |
| **`promotions`** | Discounts & Promotions | `deletePromotions` |

### Payload Structure

All messages MUST include `type` (the status), `scope`, and `sessionId`.

```json
{
  "type": "PROGRESS",
  "scope": "step",
  "entityType": "products",
  "operation": "generate",
  "sessionId": "SESS-123",
  "batchId": "456", 
  "processedCount": 50,
  "totalCount": 100,
  "percent": 50,
  "timestamp": "2026-02-23T12:00:00Z",
  "correlationId": "CID-789"
}
```

### Constraints & Requirements

1.  **Operation Standardization**:
    - The `operation` field MUST be `'generate'`, `'delete'`, `'process-images'`, or `'process-attachments'`.
2.  **Entity Type Normalization**:
    - The frontend MUST normalize incoming `entityType` using `normalizeEntityType` to update the correct UI progress bar.
3.  **Progress Tracking**:
    - `PROGRESS` and `COMPLETED` events MUST update the `completed` count in the state.
    - `STARTED` events MUST provide the `totalCount` to initialize UI bar widths.
4.  **Finality**:
    - `GENERATION_SESSION_COMPLETE` remains as a top-level signal that all background tasks (including post-processing) are done.

------------------------------------------------------------------------

## API Path Constants

To ensure consistency and prevent errors from outdated or mismatched path strings, the microservice uses two sets of constants for API paths.

### Internal API Paths

These paths are for the endpoints exposed by the microservice itself. They are defined in `client-extensions/ai-commerce-accelerator-microservice/utils/internalApiPaths.cjs`. All paths are prefixed with `/api/v1`.

- **`INTERNAL_API_PATHS.WORKFLOW_SESSIONS`**: `/workflows/sessions`
- **`INTERNAL_API_PATHS.WORKFLOW_BATCHES`**: `/workflows/batches/:sessionId`

*(and all other internal paths...)*

### Liferay API Paths

These paths are for the Liferay Headless APIs that the microservice calls. They are defined in `client-extensions/ai-commerce-accelerator-microservice/utils/liferayPaths.cjs`.

- **`PATH.PRODUCTS`**: `/o/headless-commerce-admin-catalog/v1.0/products`
- **`PATH.ACCOUNTS`**: `/o/headless-admin-user/v1.0/accounts`

*(and all other Liferay paths...)*

------------------------------------------------------------------------

## Workflow Audit Trail

For observability and debugging, the microservice exposes endpoints to view the workflow audit trail directly from the database.

### Endpoints

- **`GET /api/v1/workflows/sessions`**
    - Returns a list of all workflow sessions, ordered by most recent first.
    - This provides a high-level overview of all workflows that have been run.

- **`GET /api/v1/workflows/batches/:sessionId`**
    - Returns a list of all batches associated with a specific `sessionId`.
    - This allows for detailed tracing of a single workflow run.

------------------------------------------------------------------------

## Enhancing Workflow Steps for Parallel, Synchronous, and Asynchronous Execution

To support more complex workflow orchestration, the workflow step definition and execution mechanism will be enhanced.

### New Workflow Definition Structure

The `steps` array within the session context will evolve from a simple array of strings to a more descriptive array of objects. Each object will define the step's name, type, and optional sub-steps for parallel execution.

```json
"steps": [
    { "name": "initial_setup", "type": "sync" },
    {
        "type": "parallel",
        "steps": [
            { "name": "generate_accounts", "type": "sync" },
            { "name": "generate_products", "type": "sync" }
        ]
    },
    { "name": "post_processing_async", "type": "async" },
    { "name": "final_cleanup", "type": "sync" }
]
```

**Step Types:**
- **`sync`**: A step that must complete fully before the workflow proceeds to the next step. This is the default and current behavior for individual steps.
- **`parallel`**: A container step that holds an array of sub-steps. All sub-steps within a `parallel` block are initiated concurrently. The `parallel` step itself is considered complete only when *all* its sub-steps have completed.
- **`async`**: A step that is initiated, and the workflow immediately proceeds to the next step without waiting for the `async` step's completion. The `async` step runs independently in the background.

### Required Refactoring Steps

#### 1. Update `persistenceService.cjs`

**Objective**: Modify the database schema and data access methods to accommodate the new workflow definition.

- **`workflow_sessions` table**:
    - Rename the `current_step` column to `current_steps`.
    - Change the data type of `current_steps` to `TEXT` to store a JSON array representing all currently active steps (especially for parallel execution).
- **`_initSchema` method**: Update the `CREATE TABLE` statement to reflect the `current_steps` column change.
- **`createSession` method**: Modify to accept a `currentSteps` array. This array will be serialized to JSON before storage.
- **`getSession` method**: Update to parse the `current_steps` JSON array into an object when retrieving a session.
- **`updateSession` method**: Enhance to correctly handle updates to the `current_steps` array.
- **New `updateSessionCurrentSteps` method**: Add a dedicated method for atomic updates to the `current_steps` array.

#### 2. Refactor `batchCallbackService.cjs`

**Objective**: Rewrite the core workflow orchestration logic to interpret and execute the new step types.

- **`_checkSessionCompletion` method**:
    - This method will be significantly re-architected.
    - It will interpret the new `steps` array structure from `session.context`.
    - **Synchronous Steps**: Maintain similar logic to the current implementation, ensuring the current step completes before moving to the next.
    - **Parallel Steps**:
        - Identify all sub-steps within a `parallel` block.
        - Initiate all sub-steps concurrently (e.g., by calling their respective generator methods).
        - The `parallel` step itself will remain active until all its sub-steps are marked as complete by incoming batch callbacks.
    - **Asynchronous Steps**:
        - Initiate the `async` step (e.g., call its generator method).
        - Immediately advance the workflow to the *next* top-level step without waiting for the `async` step's completion.
        - **Status**: [DONE] Implemented in `BatchCallbackService._advanceWorkflow`.
    - The `current_steps` column in `workflow_sessions` will be actively managed to reflect which steps are currently in progress.

#### 3. Update Generator Services (`accountGenerator.cjs`, `productGenerator.cjs`, etc.)

**Objective**: Adapt generator logic to create sessions using the new workflow definition.

- Modify the `generateAccounts`, `generateProducts`, and similar methods to define their workflows using the new object-based `steps` array.
- Ensure that calls to `persistenceService.createSession` correctly pass the initial `currentSteps` based on the new structure.

#### 4. Update Delete Workflow (`deleteCoordinatorService.cjs`)

**Objective**: Adapt the delete workflow to use the new step definition.

- Modify `runDeleteSelectedAndMonitor` and `runDeleteAndMonitor` to define their deletion sequences using the new object-based `steps` array.
- Ensure that calls to `persistenceService.createSession` correctly pass the initial `currentSteps` based on the new structure.

Rule: Zero-Silent-Failures — Every asynchronous operation in the Microservice CX must be wrapped in a NestJS Exception Filter that emits a WebSocket errorRef to the Frontend UI CX if it fails. Any logic over 10 lines requires a unit test using MSW to mock Liferay's response.

---

## Agent Analysis (Self-Correction & Findings)

### Attachment Generation Lifecycle

- **Ownership**: Generators (`MockDataGenerator`, `AIService`) are responsible for deciding which products should receive attachments based on user-supplied `imageRatio` and `pdfRatio`. They must populate the `images` (array of objects/strings) and `attachments` (array of filenames) properties on the product objects.
- **Processing**: The `attach-images` and `attach-pdfs` steps in `ProductGenerator` filter the product list for these properties and delegate to `MediaGenerator` for binary creation and Liferay submission.
- **Persistence**: Any normalization of `options` (e.g., converting string ratios to numbers) performed during a step must be saved back to the `workflow_sessions` table using `persistence.updateSessionContext` to ensure subsequent parallel or sequential steps have access to the corrected types.

### Data Generation Architecture Review

An analysis of the data generation workflow within the `ai-commerce-accelerator-microservice` component has been completed. The following points summarize the architecture and its constraints, serving as context for future modifications.

1.  **Core Architecture is Sound**: The system uses a stateful, asynchronous, stepbased workflow engine.
    *   **Orchestrator**: `services/batchCallbackService.cjs` manages the state machine.
    *   **State Persistence**: `services/persistenceService.cjs` uses a local SQLite database (`workflow_sessions`, `workflow_batches`) to track job state, which is crucial for resilience and debugging.
    *   **Generators**: Files in `generators/*.cjs` define the sequence of steps for creating specific entities. `productGenerator.cjs` is the most complete implementation and should be considered the "best practice" template.

2.  **Critical API Constraint**: Liferay's batch API callbacks are **stateless**. They do not return any context identifying the original request.
    *   **Necessary Workaround**: The current implementation correctly works around this by generating a unique `batchERC` for each outbound batch request and appending it as a query parameter to the callback URL. This `batchERC` is the sole mechanism for correlating a callback with a persisted workflow step. **This pattern must be preserved.**

3.  **Entity Dependency Pattern**: The creation of dependent entities (e.g., Account Addresses) requires the parent entity's numeric ID.
    *   **Analysis**: The headless APIs (e.g., `/v1.0/accounts/{accountId}/postal-addresses/batch`) confirm this requirement. It is not possible to associate children using the parent's `externalReferenceCode` at creation time.
    *   **Conclusion**: The observed pattern of **(1) Create Parents -> (2) Wait for Completion -> (3) Fetch Parent IDs -> (4) Create Children** is a necessary and correct implementation due to this API limitation. Suggestions to "optimize" this by removing the fetch step are not feasible.

### Actionable Recommendations (Internal Improvements)

The following recommendations are for internal code quality and maintainability, and they respect the external API constraints:

*   **Standardize Validation**: All generators should implement `validateConfig` and `validateOptions` methods to fail fast.
*   **Refactor `batchCallbackService`**: The `_checkSessionCompletion` method should be broken into smaller private helpers to improve readability.
*   **Implement "Dry Run" Mode**: A `dryRun: true` flag would be highly beneficial for debugging. It would execute data generation but stop before making API calls, logging the final payload instead.

### Deletion Discovery & Sequencing (Analysis Finding)

Analysis of the account deletion failure revealed a critical conflict between workflow sequencing and entity discovery logic:

1.  **Sequencing Dependency**: `deleteOrders` must precede `deleteAccounts` due to Liferay referential integrity.
2.  **Discovery Flaw**: `LiferayService.getAccounts` relies on querying existing orders when a `channelId` is provided. If orders are already deleted, discovery returns zero results, causing account deletion to be silently skipped.
3.  **Corrective Pattern**: Deletion discovery for entities with complex or volatile relationships (like Accounts) MUST prioritize stable identifiers like `externalReferenceCode` prefixes (e.g., `AICA-ACC-*`) over relational discovery (orders). Specialized discovery methods in `LiferayService` must be updated to combine relational filters with prefix-based filters and ensure parameters like `filter` and `search` are correctly propagated from `deleteByFilter`.

### Product Type Constraint (API Finding)

Investigation of product creation failures (`CPDefinitionProductTypeNameException`) revealed a critical API constraint:

1.  **Mandatory Type**: The Liferay Headless Commerce API (v1.0) requires the `productType` field to be `simple` for all products, even those intended to have variants or SKU contributors.
2.  **Invalid Values**: Values like `variable` or `grouped` are rejected by the API validation layer during creation.
3.  **Variant Handling**: Conceptual "variable" products are created as `simple` products first. Variants are then established by linking `productOptions` and creating additional `skus` in subsequent update steps.
4.  **Actionable Pattern**: All generator logic, AI prompts, and schemas must strictly use `productType: 'simple'` to ensure successful initial creation.

### SKU Property Constraints (API Finding)

Investigation of batch import failures (`IllegalArgumentException: Unrecognized field "active"`) revealed constraints on the `Sku` DTO:

1.  **Unsupported Fields**: The `Sku` DTO in Liferay Headless Commerce Admin Catalog API (v1.0) does not recognize an `active` property. Including this field in a batch payload (e.g., for products or skus) will cause the entire import task to fail.
2.  **Derived Status**: In Liferay, a SKU's "active" or "enabled" state is determined by its configuration rather than a simple boolean flag.
3.  **Activation Rule**: A SKU linked to a product with SKU-contributing options (e.g., Color, Size) is considered active only if it has an explicit `skuOption` entry for **every** contributing option defined on the product.
4.  **Actionable Pattern**: Always remove the `active` property from SKU objects before submission. Ensure that generated variant SKUs include values for all product options marked as `skuContributor` to ensure they are activated by Liferay.

### Commerce Option Value Constraints (API Finding)

Investigation of Commerce Option behavior revealed strict rules about which field types support predefined values:

1.  **Values Supported (Value-Driven)**: The following field types support/require `OptionValues`. The user MUST select from a predefined list:
    *   **Select from List** (`select`)
    *   **Single Selection** (`radio`)
    *   **Multiple Selection** (`checkbox_multiple`)
    *   **Boolean** (`checkbox`) - Treated as a selection (e.g., "Yes" or "No").
    *   **Select Date from List** (`select_date`) - User picks from a list of fixed dates.
2.  **Values NOT Supported (Free-Form/Input)**: The following field types MUST NOT have `OptionValues` defined. They rely on user input or a full date picker:
    *   **Numeric** (`numeric`)
    *   **Text** (`text`)
    *   **Date** (`date`) - This uses a standard date picker UI without fixed value restrictions.
3.  **Validation Rule**: Attempting to create `OptionValues` for value-less field types (like Numeric) may cause API errors or inconsistent behavior in the UI.
4.  **Actionable Pattern**: Generator logic must check the `fieldType` of an Option before attempting to create its values. Use `COMMERCE_CONSTRAINTS.FIELD_TYPES_WITH_VALUES` to gate value creation.

### AI Schema & Option Metadata

To ensure the AI generates data that can be correctly mapped to Liferay Commerce, the `options` property in the AI schema includes metadata:

1.  **`fieldType`**: The AI must specify the intended Liferay field type (e.g., `select`, `numeric`). This determines whether the system creates predefined `OptionValues`.
2.  **`skuContributor`**: The AI must flag which options should define physical variants. This prevents "over-generation" of SKUs for non-contributing required fields (like "Screen Size").
3.  **Consistency**: Both `MockDataGenerator` and `AIService` must return this metadata to ensure the `ProductGenerator` can consistently apply Liferay's business rules for SKU creation and activation.

### Initial Product SKU Omission (Architecture Finding)

Investigation into SKU option-linking failures revealed a conflict when including a base SKU in the initial product creation payload for products intended to have variants:

1.  **Stateless Initial SKU**: If a SKU is included in the initial `createProductsBatch` call, it is created before product options are linked.
2.  **UPSERT Limitation**: Subsequent attempts to update this existing SKU via the `product-skus` batch (using the same ERC or SKU string) to add `skuOptions` sometimes fail to establish the relationship correctly in Liferay Commerce.
3.  **Corrective Pattern**: For products where `generateSkuVariants` is enabled and SKU-contributing options exist, the `skus` array MUST be omitted from the initial product creation payload.
4.  **Deferred Creation**: All SKUs for these products are then created for the first time in the `product-skus` step (after options are linked), ensuring that the initial creation record includes the mandatory `skuOptions` mapping.
5.  **Simple Product Fallback**: Products without SKU-contributing options (simple products) still include their single SKU in the initial creation to ensure they are immediately purchasable.

### Inventory Level and Distribution Control (Architecture Finding)

To provide more granular control over the generated inventory data, the `update-inventory` step now strictly enforces the following configuration parameters:

1.  **Distribution Gate**: The `inventoryAssignmentRatio` (0-100) is applied per product. A random check determines if a product receives any inventory entries across the assigned warehouses.
2.  **Dynamic Quantity Generation**: When a SKU does not have an explicitly assigned quantity, a random value is generated within the range defined by `inventoryMin` and `inventoryMax`.
3.  **Deduplication and Summing**: If multiple assignments result in the same SKU/Warehouse pair (e.g., due to different source data paths), the quantities are summed and deduplicated before the batch UPSERT to prevent Batch Engine collisions.

### Price List & Pricing Engineering Learnings (Architecture Finding)

Investigation into Price List creation and scoping revealed critical constraints within Liferay Commerce Pricing V2.0:

1.  **Base Price List Conflict**: Liferay allows only **one** base price list per catalog and type. Attempting to create a second one (e.g., with `catalogBasePriceList: true`) results in a `DuplicateCommerceBasePriceListException` (500 Error).
    *   **Actionable Pattern**: Always set `catalogBasePriceList: false` for generated Price Lists to ensure they can coexist with any existing system base price list.
2.  **Deletion Protection**: To prevent accidental deletion of critical system data, the deletion workflow must strictly protect base price lists that do not belong to the application's own namespace.
    *   **Actionable Pattern**: Only delete price lists and promotions that are either marked as non-base OR carry the application's unique prefix (e.g., `AICA-`).
3.  **Numeric ID Scoping (Indexing Resilience)**: ERC-based scoping for batch operations (e.g., price entries) is highly vulnerable to Liferay's indexing lag. If a parent Price List is created and its children are submitted immediately, Liferay may fail to "discover" the parent by ERC.
    *   **Actionable Pattern**: Capture and prioritize numeric IDs (`priceListId`) over ERCs for all batch scoping and item properties. Bypassing ERC discovery at the database level ensures 100% reliability immediately after parent creation.
4.  **Path and Parameter Constraints**:
    *   **Case Sensitivity**: Pricing V2.0 Headless API strictly requires `camelCase` for ERC path segments (`by-externalReferenceCode`).
    *   **Batch URL Redundancy**: Avoid passing parent identifiers (like `priceListId`) as query parameters to nested batch endpoints (e.g., `/price-lists/price-entries/batch`). Liferay often interprets these as identifiers for the *ImportTask* object itself, leading to ERC collisions ("external reference code already in use").
    *   **Scoping Priority**: Rely entirely on item-level properties (within each record in the batch body) for scoping to avoid URL-based conflicts.
5.  **Soft Fallback Handling**: SDK methods that demote 404s to "Soft Results" (returning an empty object instead of throwing) must be handled carefully by callers. A "Soft Empty" result must be explicitly checked to trigger creation logic, otherwise the system will incorrectly assume the entity exists.
