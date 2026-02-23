# AI Commerce Accelerator - Microservice TODO

## 1. Core Fixes (Protocol & Constants)

### [x] Fix Warehouse ERC Prefix
**Analysis**: The `ERC_PREFIX` object in `utils/constants.cjs` was missing the `WAREHOUSE` constant. When `createERC(ERC_PREFIX.WAREHOUSE)` was called, it resolved to `undefined`, resulting in ERCs like `undefined-1771533564373-98088246`.
**Proposed Steps**:
1. Open `client-extensions/ai-commerce-accelerator-microservice/utils/constants.cjs`.
2. Locate the `ERC_PREFIX` object.
3. Add `WAREHOUSE: `${APP_PREFIX}WH`` to the object properties. (COMPLETED)

### [x] Restore Missing Facade Method (`updateInventory`)
**Analysis**: The recent refactor moved coordination logic to the `LiferayService` facade in `index.cjs`, but the delegation for inventory updates was missed. This causes a `TypeError` when the `update-inventory` step attempts to call the method.
**Proposed Steps**:
1. Open `client-extensions/ai-commerce-accelerator-microservice/services/liferay/index.cjs`.
2. Add an `updateInventory` method to the `LiferayService` class.
3. Delegate the call to `this.rest.updateProductInventory(config, warehouseId, sku, inventoryData)`. (COMPLETED)

### [x] Fix Workflow Stall in Deletion (Simulated Batching)
**Analysis**: The deletion workflow stalled at steps using 'Simulated Batching' (like Warehouses). The orchestrator was not capturing handler outcomes, leaving batches stuck in 'PREPARED' status. Additionally, a stale session object in the loop caused redundant log messages.
**Proposed Steps**:
1. Modify `batch/callback.cjs` to refresh session state in every iteration of the `_checkSessionCompletion` loop.
2. Update `_runStep` to await handler results and update the database with `COMPLETED` (simulated) or `SUBMITTED` (native) status. (COMPLETED)

---

## 2. Product Generation Workflow Improvements

### [x] Resilient ID Resolution (Stale Search Index)
**Analysis**: Newly created products are not immediately searchable due to Liferay's asynchronous indexing. The `resolve-product-ids` step currently makes a single attempt to find them via GraphQL, often returning a partial list (e.g., 5 out of 10). This leaves the remaining products with `undefined` IDs, breaking all subsequent steps.
**Proposed Steps**:
1. Modify `ProductGenerator._runResolveProductIdsStep` in `productGenerator.cjs`.
2. Implement a retry loop using the `pollingRetries` and `pollingDelay` values from the configuration.
3. Inside the loop, perform the GraphQL discovery and check if the number of resolved products matches the expected count.
4. Only proceed to the next step once all IDs are resolved or the maximum retries are exhausted. (COMPLETED)

### [x] Explicit Product Options Linking
**Analysis**: Observations confirm that while `productSpecifications` are successfully linked via the Batch Engine create payload, `productOptions` are ignored. Global options must be linked to products via an explicit REST call.
**Result**: **FIXED**. Added `link-product-options` step definition and implementation using explicit REST calls.

### [x] Consolidate Attachment and Inventory Logic
**Analysis**: Logic for creating images, PDFs, and updating inventory currently exists in two places: as explicit generator steps and within the `onSessionComplete` hook. This redundancy is confusing and can lead to race conditions.
**Result**: **FIXED**. Refactored `onSessionComplete` to remove redundant loops; generator steps are now the single source of truth.

### [x] Fix Missing Images and PDF Attachments
**Analysis**: Beyond the ID resolution failure, we must ensure that once IDs are available, the binary data transfer is reliable. The current implementation uses an `ObjectStorageService` to host images/PDFs which Liferay then fetches via URL. Any misconfiguration in the sidecar endpoint or Liferay's ability to reach the microservice will result in "silent" attachment failures.
**Result**: **FIXED**. 
1. Implemented `addProductImageByBase64` and `addProductDocumentAttachmentByBase64` in `rest.cjs` and facade.
2. Added `multipart` and `Document Library` (URL pattern) attachment methods to `rest.cjs`.
3. Updated `MediaGenerator.cjs` to handle Live vs Demo modes and submit content via Base64 for reliability.
4. Restored `ObjectStorageService.cjs` for data preservation/export use only.

### [x] Resolve Warehouse IDs
**Analysis**: Warehouses are created via Batch Engine, but their numeric IDs are not returned in the submission. Subsequent steps (like `update-inventory`) require these IDs to interact with Liferay REST APIs.
**Result**: **FIXED**. Implemented `resolve-warehouse-ids` step after warehouse generation to resolve numeric IDs via GraphQL filtering by ERC.

### [x] Refresh Session Context in Step Handlers
**Analysis**: Step handlers (e.g., `_runUpdateInventoryStep`) receive a `session` object passed by the orchestrator at the start of the workflow. However, as steps complete and update the `context_json` in the database (e.g., adding resolved IDs), the handlers were still using the initial stale object.
**Proposed Steps**:
1. Update `ProductGenerator.cjs` handlers to re-fetch the latest session context using `persistence.getSession(sessionId)` at the start of each step method. (COMPLETED)

---

## 3. System Stability

### [x] Handle Shutdown Exceptions (`write EPIPE`)
**Proposed Steps**:
1. Implement graceful shutdown sequence in `server.cjs` by closing WebSocket server and awaiting logger draining. (COMPLETED)

### [x] Improve Error Message Clarity (Remove 'undefined' references)
**Proposed Steps**:
1. Review `logger` calls in `generators/*.cjs` and refactor template strings to avoid referencing properties that might be null/undefined directly in the message string. (COMPLETED)

---

## 4. Discovery Enhancements (Standardization)

### [x] Extend Query-Level Exclusions
**Proposed Steps**:
1. Update `getWarehouses`, `getSpecifications`, and `getOptions` in `liferay/index.cjs` to incorporate proactive name-based filtering using the `_buildNameExclusionFilter(exclusions)` helper. (COMPLETED)

---

## 5. Runtime Exceptions (Reported)

### [x] GraphQL DataFetchingException (Specifications)
**Analysis**: The `product-data-generation` step was encountering intermittent `DataFetchingException` (500 Internal Server Error) when querying Liferay's GraphQL endpoint for specifications.
- **Root Cause**: The filter built in `liferay/index.cjs` for `getSpecifications` included `title sw '${search}'`. While `title` is a valid field in GraphQL, the underlying OData engine for specifications does not support filtering on this localized field, resulting in a server-side `null` pointer or data fetching exception.
- **Trigger**: Occurs during the "Verification list for specifications" in `ProductGenerator.cjs` which passes a `search` prefix.
- **Affected Code**: `client-extensions/ai-commerce-accelerator-microservice/services/liferay/index.cjs` (lines 133-154).
**Result**: **FIXED**. Modified `getSpecifications` to filter solely on `key` and updated `_buildNameExclusionFilter` to use `key` for specifications.

### [x] Persistent Warehouse Resolution Failure (STALE_INDEX)
**Analysis**: Despite a 12-attempt retry loop, `resolve-warehouse-ids` was still timing out with `STALE_INDEX`.
- **Root Cause**: A structural mismatch in the data flow. `WarehouseGenerator.createWarehouses` returned a batch reference (containing the **Batch ERC**) instead of individual warehouse data when using batch mode. `ProductGenerator` then incorrectly used this batch ERC to attempt warehouse-level ID resolution. Since the batch ERC never matches an individual warehouse, Liferay returned `null`, triggering the `STALE_INDEX` retry logic until timeout.
- **Affected Code**: `WarehouseGenerator.cjs` (return value of `createWarehouses`) and `productGenerator.cjs` (`_runResolveWarehouseIdsStep`).
**Result**: **FIXED**.
1. Refactored `WarehouseGenerator.createWarehouses` to return the `normalizedWarehouseDataList` (containing individual ERCs).
2. Updated `ProductGenerator._runWarehouseGenerationStep` to filter out any remaining batch ERCs and added more robust verification of resolved IDs.

### [x] GraphQL DataFetchingException (Accounts Discovery)
**Analysis**: The `deleteAccounts` step was consistently failing with `DataFetchingException: null` in Liferay's GraphQL layer.
- **Root Cause**: The orchestrator was "standardizing" discovery fields in `deleteByFilter` to include both Commerce and User fields (e.g., `productId`, `title`). When these were passed to the `headlessAdminUser_v1_0/accounts` GraphQL query, Liferay crashed because those fields don't exist on the core Account DTO. Additionally, mixing `sw` filters on ERCs with `ne` filters on localized names was problematic in some environments.
- **Result**: **FIXED**.
    1. Refactored `deleteByFilter` to define entity-specific discovery fields.
    2. Standardized all discovery methods (`getProducts`, `getAccounts`, etc.) to explicitly validate and filter requested fields against a whitelist of supported fields per entity.
    3. Switched `getAccounts` to use the REST API for discovery, as it is more stable than GraphQL for core User/Account entities with complex filters.
    4. Improved filter logic to automatically skip redundant name-based exclusions when a specific AI-generated prefix filter is provided.

### [x] Redundant "Step completed" Logging (Loop Atomicity)
**Analysis**: Step completion was being logged and emitted multiple times for fast synchronous steps.
- **Root Cause**: The orchestrator loop in `BatchCallbackService._checkSessionCompletion` re-evaluated state without persisting the updated `current_steps` to the database before continuing. This caused subsequent iterations to re-detect the same completion events.
- **Result**: **FIXED**. Ensured that `persistence.updateSessionCurrentSteps` is called with the latest filtered state immediately after detection and before any loop `continue`.

### [x] Graceful Shutdown Logger Failure (write EPIPE)
**Analysis**: During process termination (SIGTERM/SIGINT), the logger throws an uncaught `EPIPE` error when trying to write to `process.stdout` or `process.stderr`.
- **Root Cause**: The microservice attempts to log status updates during its graceful shutdown sequence (e.g., "WebSocket server stopped"). If the parent process or container orchestrator has already closed the standard input/output pipes, the `out.write()` call in `Logger._log` throws `EPIPE`.
- **Affected Code**: `client-extensions/ai-commerce-accelerator-microservice/utils/logger.cjs` (line 152).
**Result**: **FIXED**. Wrapped `out.write()` calls in `Logger._log` with `writable` checks and `try-catch` blocks to safely handle `EPIPE` errors during shutdown.

### [x] Missing Context IDs in Full Deletion
**Analysis**: The "Full environment deletion" process (triggered via `runDeleteAndMonitor`) does not explicitly populate `channelId` and `catalogId` at the root of the session context.
- **Root Cause**: `DeleteCoordinatorService.runDeleteAndMonitor` initialized the session context with only `config`, `options`, `sessionId`, and `steps`. However, the delete orchestrator (`BatchCallbackService._startStep`) expects `channelId` and `catalogId` to be present directly in `session.context` to pass them to entity-specific deletion handlers.
- **Affected Code**: `client-extensions/ai-commerce-accelerator-microservice/services/deleteCoordinatorService.cjs` (line 30).
**Result**: **FIXED**. Updated `DeleteCoordinatorService.runDeleteAndMonitor` to extract and populate these IDs at the context root, matching the structure of `runDeleteSelectedAndMonitor`.

### [x] Fix Product Inventory Update Schema Mismatch
**Analysis**: The `update-product-inventory` operation was failing with a 400 Bad Request.
- **Root Cause**: The microservice was sending an unsupported `neverExpire` property in the `WarehouseItem` payload. Additionally, the numeric `product.id` was being incorrectly passed as the SKU string.
- **Result**: **FIXED**.
    1. Modified `ProductGenerator._runUpdateInventoryStep` to remove `neverExpire`.
    2. Corrected the `liferay.updateInventory` call to pass the actual alphanumeric SKU.
    3. Added support for iterating over and updating inventory for all SKUs and variants associated with a product.

### [x] Analyse Missing Product Images and PDFs
**Objective**: Understand why product images and PDFs are not being generated and attached to products.
**Analysis Findings**:
- **Type Mismatch (Validation Error)**: `options.imageRatio` and `options.pdfRatio` are received as strings from the UI. `ProductGenerator._generateProductData` converts them to Numbers on the `options` object but fails to persist these mutated options back to the session context. Subsequent steps (like `_runAttachImagesStep`) re-fetch the session from the DB, get the original strings, and pass them to `MediaGenerator.validateOptions`, which throws a `TypeError` because it expects a `number`. This explains the `Failed to process image attachments` log message.
- **MockDataGenerator Bug (Demo Mode)**: `MockDataGenerator.generateProductData` does not populate the `attachments` property for products and ignores the `pdfRatio` option entirely. This causes the `attach-pdfs` step to skip because `withPdfs` is empty.
- **AIService/Prompt/Schema Bug (Live Mode)**: The `product.json` schema and `product.md` prompt do not include an `images` property. Consequently, AI-generated products never have the `images` property, causing the `attach-images` step to skip.
- **Logic Redundancy**: There is a disconnect between Generators and MediaGenerator regarding who owns the "ratio" logic. Generators should decide which products get attachments and populate the properties; MediaGenerator should then process those properties without re-applying a random ratio.
**Result**: **FIXED**.
1. Fixed `ProductGenerator.cjs` to persist normalized `options` (specifically numeric ratios) back to the session context.
2. Updated `MockDataGenerator.cjs` to populate `images` and `attachments` based on ratios.
3. Updated `AIService.cjs`, `product.json`, and `product.md` to include `images` in AI-generated data and fix `specifications` multilingual structure.
4. Refactor `MediaGenerator.cjs` to use populated properties and remove redundant ratio filtering.

### [x] Analyse Account Deletion Failure in Delete Workflow
**Objective**: Understand why accounts are not being deleted as part of the delete workflow.
**Analysis Findings**:
- **Protocol Mismatch (Step Order)**: The delete workflow executes `deleteOrders` before `deleteAccounts`. `LiferayService.getAccounts` (used for discovery) has logic that, if `channelId` is provided, attempts to find accounts by querying orders in that channel. Since orders have already been deleted, this query returns zero results, causing the account deletion step to be skipped.
- **Discovery Logic Bug**: `LiferayService.deleteByFilter` fails to pass the `filter` and `search` parameters to specialized discovery methods like `getAccounts`, `getProducts`, and `getPriceLists`. This prevents any caller-supplied filters (like ERC prefix filters) from being applied during these steps.
- **Overly Restrictive Discovery**: `getAccounts` returns an empty result set immediately if `channelId` is present but no orders are found, even if other filters (like an ERC prefix) are provided.
**Result**: **FIXED**.
1. Fixed `LiferayService.deleteByFilter` to pass `filter` and `search` parameters to all specialized discovery methods.
2. Refactored `LiferayService.getAccounts` to combine `channelId` discovery with other filters, preventing early exit.
3. Updated `BatchCallbackService._checkIfEntitiesExist` and `deleteAccounts` step handler to use a default ERC prefix filter (`AICA-ACC-*`) for account discovery.

### [x] Analyse WebSocket Progress Communication Mismatch
**Objective**: Understand why batch updates are not being reflected in the UI progress bars.
**Analysis Findings**:
- **Redundant Event Prefixes**: Current event types like `BATCH_START` and `SESSION_COMPLETE` duplicate the information that should be in a `scope` field. 
- **Hierarchical Mismatch**: The system lacks a clear distinction between **Session** (overall flow), **Step** (logical entity category), and **Batch** (physical Liferay submission).
- **Operation Mismatch**: Frontend `useRealtimeWebSocket.js` ignores progress updates unless `operation` is exactly `'generate'`, `'process-images'`, or `'process-attachments'`.
- **Entity Type Mapping**: Microservice sends specific step keys (e.g., `'postal-addresses'`, `'generate-warehouses'`), but the frontend expects normalized keys (`'accounts'`, `'warehouses'`).
- **Granular Progress Ignored**: `BATCH_PROGRESS` (soon to be `PROGRESS` with scope `batch`) events are logged but never update the UI state.
- **Missing Entity Support**: Support for `warehouses`, `price-lists`, and `specifications` is inconsistent across emitters and handlers.
- **ProgressService Bug**: `batchFailed` incorrectly calls `emitBatchCompleted`.
**Result**: **FIXED**.
1. Unified events into `STARTED`, `PROGRESS`, `COMPLETED`, `FAILED` with mandatory `scope` field.
2. Implemented hierarchical emission in `BatchCallbackService` (STEP level) and Generators (BATCH level).
3. Enhanced `normalizeEntityType` in both microservice and frontend to ensure consistent category mapping.
4. Refactored `useRealtimeWebSocket.js` to route updates based on `scope` and `entityType`, ensuring granular progress updates the UI.
5. Fixed `ProgressService` bugs and aligned legacy emitters with the new protocol.

### [x] Account Deletion Failure (OData Filter Compatibility)
**Analysis**: The `deleteAccounts` workflow step was failing with `InvalidFilterException: Filter expressions must be boolean`.
- **Root Cause**: The filter built for account discovery used `externalReferenceCode sw 'AICA-ACC'`. The Liferay Headless Admin User (Accounts) REST API does not support the `sw` operator (unlike Commerce APIs). Additionally, standard OData functions like `startswith()` are often unsupported or behave inconsistently for core Account entities in some Liferay versions.
- **Result**: **FIXED**.
    1. Updated `LiferayService.getAccounts` to utilize the native `search` parameter of the Headless REST API instead of building an OData filter for prefix matching. This provides a reliable, built-in way to find accounts by ERC or Name prefix.
    2. Updated `BatchCallbackService._checkIfEntitiesExist` and the `deleteAccounts` step handler to pass the prefix as a `search` parameter.
    3. Implemented a global `_normalizeFilter` transformation in the `LiferayService` facade to convert any remaining `sw` operators to the compliant `startswith()` function for entities that support standard OData functions.

---

## 6. Verification Tasks

### [x] Verify redundant `_checkSessionCompletion` removal
**Analysis**: Commit `a437fd98f22c64bb2d9f6a015c911ed28661224f` removed manual calls to `batchCallback._checkSessionCompletion` from all generator step handlers (Accounts, Orders, Products). 
- **Reason**: These manual calls were redundant because the `BatchCallbackService` orchestrator centrally manages session completion checks. Triggering them from within handlers caused duplicate execution threads, race conditions in state updates, and noisy logs.
**Result**: **VERIFIED**. Code review confirms that the `while` loop in `BatchCallbackService` correctly handles synchronous advancement. Logs confirm smooth transitions without recursion.

---

## 7. Strategic Roadmap (Implementation Priority)

### [x] 1. WebSocket Progress Communication Mismatch
**Rationale**: This is the highest priority infrastructure fix. It aligns the Microservice's reporting with the Frontend's expectations. Establishing a reliable hierarchical event protocol (`session` > `step` > `batch`) ensures accurate visual feedback for all subsequent feature development and debugging.

### [x] 2. Account Deletion Failure in Delete Workflow
**Rationale**: Reliable environment cleanup is essential for deterministic testing. Fixing the discovery logic and step ordering in the deletion workflow allows for a "clean slate" between test runs of the product and order generators, preventing data duplication and skewed results.

### [x] 3. Missing Product Images and PDFs
**Rationale**: This is a high-value feature with complex data dependencies. It requires coordinated changes across the AI Service (prompts/schema), Mock Data Generator, and Media Generator. Addressing this after securing observability (Priority 1) and environment stability (Priority 2) ensures a more efficient implementation cycle.
