# Workflow State, Batch Correlation, and WebSocket Progress Specification

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
    - Stores long-lived configuration via Liferay Objects
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

#### GraphQL API
- **Location**: `client-extensions/ai-commerce-accelerator-microservice/api-schemas/liferay_schema.graphql`
- **Format**: GraphQL Schema Definition Language (SDL)
- **Purpose**: This schema defines the types, queries, and mutations available through Liferay's Headless GraphQL API. It is used for crafting GraphQL queries and understanding the available data graph.

------------------------------------------------------------------------

## Storage strategy

### Guiding principle

**Workflow execution state must not depend on Liferay availability or
Headless API latency.**

### Recommended hybrid model

#### Microservice-local storage (fast path, source of truth)

A hybrid persistence model will be used to balance performance and durability.

1.  **Primary Store (Source of Truth):**
    - A lightweight, file-based SQLite database (lifetime scoped to the process).
    - It stores the canonical record of:
        - active workflow session context
        - batch correlation and callback state
        - idempotency and concurrency control

1.  **Secondary Store (Read-Through Cache):**
    - An in-memory cache sits in front of the database to reduce disk I/O.
    - **Pattern:** All database operations are wrapped by the cache.
        - **Reads:** Attempt to read from the cache first. On a cache miss, read from the database, populate the cache, and then return the data.
        - **Writes/Updates:** Write directly to the database and then immediately update or invalidate the corresponding entry in the cache.
    - **Abstraction:** This caching logic is an internal implementation detail of the persistence service and is not exposed to the rest of the application.
    - **Correctness:** Correctness must never depend on the cache. The database is always the source of truth.

#### Liferay Objects (slow path, visibility and configuration)

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