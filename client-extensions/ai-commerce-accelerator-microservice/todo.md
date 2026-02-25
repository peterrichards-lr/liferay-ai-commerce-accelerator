# AI Commerce Accelerator - Microservice TODO

## 1. Core Fixes (Protocol & Constants)

### [x] Fix Warehouse ERC Prefix
**Analysis**: The `ERC_PREFIX` object in `utils/constants.cjs` was missing the `WAREHOUSE` constant. When `createERC(ERC_PREFIX.WAREHOUSE)` was called, it resolved to `undefined`, resulting in ERCs like `undefined-1771533564373-98088246`.
**Result**: **FIXED**.

### [x] Restore Missing Facade Method (`updateInventory`)
**Analysis**: The recent refactor moved coordination logic to the `LiferayService` facade in `index.cjs`, but the delegation for inventory updates was missed. This causes a `TypeError` when the `update-inventory` step attempts to call the method.
**Result**: **FIXED**.

### [x] Fix Workflow Stall in Deletion (Simulated Batching)
**Analysis**: The deletion workflow stalled at steps using 'Simulated Batching' (like Warehouses). The orchestrator was not capturing handler outcomes, leaving batches stuck in 'PREPARED' status. Additionally, a stale session object in the loop caused redundant log messages.
**Result**: **FIXED**.

---

## 2. Product Generation Workflow Improvements

### [x] Resilient ID Resolution (Stale Search Index)
**Analysis**: Newly created products are not immediately searchable due to Liferay's asynchronous indexing. The `resolve-product-ids` step currently makes a single attempt to find them via GraphQL, often returning a partial list (e.g., 5 out of 10). This leaves the remaining products with `undefined` IDs, breaking all subsequent steps.
**Result**: **FIXED**.

### [x] Explicit Product Options Linking
**Analysis**: Observations confirm that while `productSpecifications` are successfully linked via the Batch Engine create payload, `productOptions` are ignored. Global options must be linked to products via an explicit REST call.
**Result**: **FIXED**.

### [x] Consolidate Attachment and Inventory Logic
**Analysis**: Logic for creating images, PDFs, and updating inventory currently exists in two places: as explicit generator steps and within the `onSessionComplete` hook. This redundancy is confusing and can lead to race conditions.
**Result**: **FIXED**.

### [x] Fix Missing Images and PDF Attachments
**Analysis**: Beyond the ID resolution failure, we must ensure that once IDs are available, the binary data transfer is reliable. The current implementation uses an `ObjectStorageService` to host images/PDFs which Liferay then fetches via URL. Any misconfiguration in the sidecar endpoint or Liferay's ability to reach the microservice will result in "silent" attachment failures.
**Result**: **FIXED**. 

### [x] Resolve Warehouse IDs
**Analysis**: Warehouses are created via Batch Engine, but their numeric IDs are not returned in the submission. Subsequent steps (like `update-inventory`) require these IDs to interact with Liferay REST APIs.
**Result**: **FIXED**.

### [x] Refresh Session Context in Step Handlers
**Analysis**: Step handlers (e.g., `_runUpdateInventoryStep`) receive a `session` object passed by the orchestrator at the start of the workflow. However, as steps complete and update the `context_json` in the database (e.g., adding resolved IDs), the handlers were still using the initial stale object.
**Result**: **FIXED**.

---

## 3. System Stability

### [x] Handle Shutdown Exceptions (`write EPIPE`)
**Result**: **FIXED**.

### [x] Improve Error Message Clarity (Remove 'undefined' references)
**Result**: **FIXED**.

---

## 4. Discovery Enhancements (Standardization)

### [x] Extend Query-Level Exclusions
**Result**: **FIXED**.

---

## 5. Runtime Exceptions (Reported)

### [x] GraphQL DataFetchingException (Specifications)
**Analysis**: The `product-data-generation` step was encountering intermittent `DataFetchingException` (500 Internal Server Error) when querying Liferay's GraphQL endpoint for specifications.
**Result**: **FIXED**.

### [x] Persistent Warehouse Resolution Failure (STALE_INDEX)
**Analysis**: Despite a 12-attempt retry loop, `resolve-warehouse-ids` was still timing out with `STALE_INDEX`.
**Result**: **FIXED**.

### [x] GraphQL DataFetchingException (Accounts Discovery)
**Analysis**: The `deleteAccounts` step was consistently failing with `DataFetchingException: null` in Liferay's GraphQL layer.
**Result**: **FIXED**.

### [x] Redundant "Step completed" Logging (Loop Atomicity)
**Analysis**: Step completion was being logged and emitted multiple times for fast synchronous steps.
**Result**: **FIXED**.

### [x] Graceful Shutdown Logger Failure (write EPIPE)
**Analysis**: During process termination (SIGTERM/SIGINT), the logger throws an uncaught `EPIPE` error when trying to write to `process.stdout` or `process.stderr`.
**Result**: **FIXED**.

### [x] Missing Context IDs in Full Deletion
**Analysis**: The "Full environment deletion" process (triggered via `runDeleteAndMonitor`) does not explicitly populate `channelId` and `catalogId` at the root of the session context.
**Result**: **FIXED**.

### [x] Fix Product Inventory Update Schema Mismatch
**Analysis**: The `update-product-inventory` operation was failing with a 400 Bad Request.
**Result**: **FIXED**.

---

## 6. Verification Tasks

### [x] Verify redundant `_checkSessionCompletion` removal
**Result**: **VERIFIED**.

---

## 7. Strategic Roadmap (Implementation Priority)

### [x] 1. WebSocket Progress Communication Mismatch
**Rationale**: This is the highest priority infrastructure fix. It aligns the Microservice's reporting with the Frontend's expectations. Establishing a reliable hierarchical event protocol (`session` > `step` > `batch`) ensures accurate visual feedback for all subsequent feature development and debugging.

### [x] 2. Account Deletion Failure in Delete Workflow
**Rationale**: Reliable environment cleanup is essential for deterministic testing. Fixing the discovery logic and step ordering in the deletion workflow allows for a "clean slate" between test runs of the product and order generators, preventing data duplication and skewed results.

### [x] 3. Missing Product Images and PDFs
**Rationale**: This is a high-value feature with complex data dependencies. It requires coordinated changes across the AI Service (prompts/schema), Mock Data Generator, and Media Generator. Addressing this after securing observability (Priority 1) and environment stability (Priority 2) ensures a more efficient implementation cycle.

---

## 8. Warehouse & Inventory Fixes

### [x] Warehouse Inventory Duplication
**Analysis**: Inventory records were duplicated during subsequent generation runs because they lacked stable External Reference Codes (ERCs). Liferay's default batch behavior is to create new records when no ERC match is found.
**Result**: **FIXED**.

### [x] Warehouse Deletion Failure (Referential Integrity)
**Analysis**: Deleting warehouses failed because associated inventory items (WarehouseItems) were still present, violating referential integrity.
**Result**: **FIXED**.

---

## 9. Recent Runtime Stability & Bug Fixes

### [x] Missing `createWarehouseItemsBatch` Delegation
**Analysis**: The `LiferayService` facade in `index.cjs` is missing the `createWarehouseItemsBatch` method, which is implemented in `rest.cjs`. This causes a `TypeError` when the inventory update step attempts to use the batch creation method.
**Result**: **FIXED**.

### [x] Fix Batch Callback Crash (`failureDetails` Undefined)
**Analysis**: The orchestrator crashes with `Cannot read properties of undefined (reading 'slice')` if `liferay.getImportTaskFailedItemReport` returns `undefined` (which can happen on network errors or unexpected API responses).
**Result**: **FIXED**.

### [x] Media Generator Fallback Fix (parseDataUrl)
**Analysis**: `MediaGenerator` fails with `parseDataUrl: input must be a string` when `ConfigService` returns `null` for a default image or PDF. It incorrectly passes `null` to the utility function instead of using the fallback immediately.
**Result**: **FIXED**.

### [x] Fix `Invalid URL` in Image Creation
**Analysis**: `MediaGenerator.createImages` attempts to fetch image data via `axios.get(imageData.src)` without validating that `src` is a valid URL. AI-generated or malformed data can trigger an `Invalid URL` exception.
**Result**: **FIXED**.

### [x] Investigate Warehouse Deletion 500 Error
**Analysis**: Sequential `DELETE` requests for warehouses were encountering `500 Internal Server Error` (specifically `StaleStateException`) because the `deleteWarehouseItems` step was running immediately before it. Liferay's internal warehouse deletion logic attempts to clean up associated items; if they are already gone, Hibernate throws a stale state exception.
**Result**: **FIXED**. Reordered deletion workflow to run `deleteOrders` first, then `deleteWarehouses` (which handles its own items), and removed the redundant `deleteWarehouseItems` from the full deletion flow.

### [x] Fix Inventory ERC Duplication (Truncation Bug)
**Analysis**: `ProductGenerator._runUpdateInventoryStep` used `sanitizeForERC` which truncated strings to 12 characters by default. The inventory ERC pattern `AICA-INV-[warehouseERC]-[sku]` resulted in non-unique ERCs for different variant SKUs of the same product because their sanitized prefixes were identical.
**Result**: **FIXED**.

### [x] Handle Local Assets in Image Attachment (Demo Mode)
**Analysis**: In demo mode, `MockDataGenerator` used `default.webp` as the image source. `MediaGenerator.createImages` skipped it because it failed the `isValidUrl` check.
**Result**: **FIXED**.

---

## 10. Pricing & Data Generation Fixes (Feb 24)

### [x] Fix Product Options Linking and Variant Creation
**Analysis**: Options were not appearing on products, and variants were not being created despite being generated in the context. Additionally, a ReferenceError was crashing the inventory update.
**Result**: **FIXED**.

### [x] Fix SKU Validation Exception (Unrecognized field "active")
**Analysis**: The `Sku` DTO in Liferay Headless Commerce API (v1.0) does not recognize an `active` property.
**Result**: **FIXED**.

---

## 11. Orchestration & State Fixes (Feb 24)

### [x] Resolve Session Completion Race Condition
**Analysis**: Multiple `Workflow session completed` events were emitted for a single session.
**Result**: **FIXED**.

### [x] Enforce Workflow Failure Policy
**Analysis**: Sessions were marked as `COMPLETED` even when synchronous steps failed.
**Result**: **FIXED**.

---

## 12. Strategic Roadmap (Completed Feb 24)

### [x] Fix `OrderGenerator` Signature Mismatch (PRIORITY 1)
**Analysis**: `OrderGenerator.getProductsAndAccounts` was passing raw IDs instead of options objects, and incorrectly processing result items.
**Result**: **FIXED**.

### [x] Consistent `correlationId` Propagation (PRIORITY 2)
**Analysis**: WebSocket messages were missing `correlationId` due to inconsistent argument patterns between `ProgressService` and `WebSocketService`.
**Result**: **FIXED**. Standardized propagation in both services.

### [x] Align Event Types and UI Handling (PRIORITY 2)
**Analysis**: UI was resetting progress counts on batch-level `STARTED` events and not accumulating progress correctly. `normalizeEntityType` was missing several step keys.
**Result**: **FIXED**. Updated `useRealtimeWebSocket.js` to track individual batch progress and `normalizeEntityType` to support all keys.

### [x] Account Address Linking `STALE_INDEX` Failure (PRIORITY 3)
**Analysis**: Newly created accounts/addresses were not immediately searchable via GraphQL due to indexing lag.
**Result**: **FIXED**. Implemented resilient retry logic in `AccountGenerator`.

### [x] Graceful Database Shutdown (PRIORITY 3)
**Analysis**: SQLite connection should be closed during server shutdown to prevent file corruption.
**Result**: **FIXED**. Updated `PersistenceService` and `server.cjs`.

### [x] Implement Workflow Summary API (PRIORITY 4)
**Objective**: Allow callers to retrieve a detailed summary of a specific workflow session, including steps, timings, and events.
**Result**: **FIXED**. Added `getEventsForSession`, path constant, and summary GET route.

### [x] Standardize Resilient Discovery Across Generators (PRIORITY 5)
**Analysis**: Inconsistent retry patterns across generators.
**Result**: **FIXED**. Extracted `liferay.resolveByERCsWithRetry` utility and refactored generators to use it.

### [x] Improve GraphQL SDK Error Handling (PRIORITY 5)
**Analysis**: GraphQL error arrays were ignored by the `STALE_INDEX` check.
**Result**: **FIXED**. Updated `LiferayGraphQLService._fetchByERCs`.

### [x] Enhance Cache Coordination in `PersistenceService` (PRIORITY 5)
**Analysis**: `PersistenceService` lacked paged list caching for batches.
**Result**: **FIXED**. Implemented read-through caching for `getBatchesForSession`.

### [x] Add Database Indexes for Performance (PRIORITY 5)
**Analysis**: Queries by `session_id` would slow down as tables grow.
**Result**: **FIXED**. Added indexes on `session_id` for batches and events tables.

### [x] Improve Asynchronous Traceability (Correlation ID)
**Analysis**: Batch callbacks from Liferay were missing the `correlationId`, making it difficult to trace logs back to the originating UI session. Outgoing API logs also lacked this context.
**Result**: **FIXED**. Added `correlationId` to batch callback URLs, updated middleware to handle it from querystring, and ensured all internal and outgoing logs include it.

---

## 13. Stability & Utility Fixes (Feb 24 Continued)

### [x] Fix `delay is not defined` ReferenceError in LiferayService
**Analysis**: The `resolveByERCsWithRetry` method in `services/liferay/index.cjs` uses the `delay` function for retries, but it was not imported. This caused any step using this utility (like resolving IDs for products, accounts, or addresses) to crash immediately upon encountering a `STALE_INDEX` error from Liferay.
**Result**: **FIXED**. Added import for `delay` from `../../utils/misc.cjs`.

### [x] Reduce GraphQL Error Noise in Logs
**Analysis**: `LiferayGraphQLService._fetchByERCs` logged all GraphQL errors as `ERROR` level. During data generation, `DataFetchingException` (404 Not Found) is a common and expected condition caused by Liferay's indexing lag. These were cluttering the logs.
**Result**: **FIXED**. Modified `_fetchByERCs` to log missing entity errors at `DEBUG` level and provide a more informative message.

### [x] Verify `set-billing-and-shipping-addresses` Step Logic
**Analysis**: This step was verified in a live run. While the `delay` ReferenceError is resolved, the step still fails with `STALE_INDEX` after 12 retries (60s) for large data sets. Investigation revealed redundant nested retries between the facade and GraphQL services, causing excessive log volume.
**Result**: **ANALYZED & PARTIALLY FIXED**. Logical errors resolved, but performance/scalability issues identified (see Section 16).

---

## 14. Batch Callback & Verification Fixes (Feb 24)

### [x] Verify Batch Terminal Status and Counts After Callback
**Analysis**: The `BatchCallbackService.processCallback` method was assuming the callback payload's status was the final and complete state. However, Liferay's REST API status (`executeStatus`) and item counts (`processedItemsCount`, `totalItemsCount`) may lag behind the callback or be sent while the task is still technically "STARTED". Additionally, a bug in count extraction (`importTask?.data || importTask`) resulted in 0 counts if the response body was the object itself.
**Result**: **FIXED**. Added a short polling loop to verify `executeStatus` is `COMPLETED` or `FAILED` before proceeding, corrected the count extraction logic, and standardized status resolution between the callback and the REST API.

### [x] Implement Missing `getBatchStatus` API
**Analysis**: The `GET /api/v1/batch/status/:batchId` route was calling a non-existent method on `BatchCallbackService`, leading to a crash.
**Result**: **FIXED**. Added `getBatchStatus` to `BatchCallbackService` and `getBatchByDownstreamId` to `PersistenceService`.

---

## 16. SDK Refinement & Scalability (Feb 25)

### [x] Consolidate Redundant Retry Logic (STALE_INDEX)
**Analysis**: Both `LiferayService.resolveByERCsWithRetry` and `LiferayGraphQLService._executeWithRetry` implement independent retry loops for handling Liferay's indexing lag. This leads to nested retries (e.g., 12 * 12 = 144 attempts), excessive log bloat, and masked failure roots.
**Result**: **FIXED**. Standardized on a single retry mechanism within the GraphQL service (10 attempts, exponential backoff). Refactored the facade to remove its redundant loop.

### [x] Complete `correlationId` Propagation in SDK Logs
**Analysis**: Many internal logs in `rest.cjs` and `graphql.cjs` (especially Response and Retry logs) still default to `"correlationId": "system"` because the CID is not explicitly passed to the logger metadata.
**Result**: **FIXED**. Updated `_request` in `rest.cjs` and all fetchers in `graphql.cjs` to explicitly include `correlationId` from the request config.

### [x] Increase Indexing Resilience for Large Data Sets
**Analysis**: Even with retries, the final address association step fails when large numbers of accounts and addresses are created simultaneously, as Liferay's index consistency can take longer than the current 60s window.
**Result**: **FIXED**. Implemented `resolve-account-ids` step in `AccountGenerator` to wait for account indexing before proceeding to addresses. Refactored `postal-addresses` to use these resolved IDs from context, ensuring no accounts are skipped during the association phase. Increased default retry timeout and backoff in the GraphQL layer.

---

## 17. Deletion Discovery & Sequencing Fixes (Feb 25)

### [x] Fix Account Deletion Discovery (Relational Dependency)
**Analysis**: `LiferayService.getAccounts` relied on querying existing orders to discover accounts when a `channelId` was provided. Since orders are deleted first in the workflow, this discovery returned zero results, causing account deletion to be silently skipped.
**Result**: **FIXED**. Updated `getAccounts` to prioritize prefix-based discovery (`externalReferenceCode sw 'AICA-ACC'`) when a search term is provided, ensuring accounts are found even after orders are removed.

---

## 19. Current Failures & Regression Fixes (Feb 25)

### [x] Fix Product Schema for `promoPrice` (PRIORITY 1 - High Impact, Easy Fix)
**Issue**: The `product-data-generation` step fails with `Mock product data failed schema validation: must be number` for `/products/0/priceEntries/0/promoPrice`. This happens because the schema requires a `number` but the generator (and AI) often provides `null` for products without active promotions.
**Resolution**: **FIXED**. Updated `ai-schemas/product.json` to allow `null` for `promoPrice` at both the `priceEntry` and `tierPrice` levels by using `["number", "null"]` for the type.

### [x] Robust Workflow Failure Propagation (PRIORITY 2 - High Impact, Moderate Fix)
**Issue**: When `product-data-generation` fails (e.g., due to the validation error above), the workflow logs the error but the session remains in a "zombie" state or is silently skipped instead of being marked as `FAILED`. The UI is not notified of the specific failure.
**Resolution**: **FIXED**. Updated `ProductGenerator._runProductDataGenerationStep` and `BatchCallbackService` to ensure that any exception in a synchronous step handler triggers `persistence.tryFailSession` and emits a `session_failed` WebSocket event.

### [x] Deduplicate Shutdown Signal Handlers (PRIORITY 3 - Medium Impact, Easy Fix)
**Issue**: Logs show redundant `SIGTERM received` and `Database connection closed` messages during shutdown. This indicates that handlers in `server.cjs` might be registered multiple times (e.g., inside and outside the async IIFE) or that the sequence is being triggered twice.
**Resolution**: **FIXED**. Audited `server.cjs` and ensured signal handlers are registered exactly once using `process.once`.

### [x] Refine `MockDataGenerator` Schema Adherence (PRIORITY 4 - Medium Impact, Easy Fix)
**Issue**: The `MockDataGenerator` might be producing data structures that deviate slightly from the recently updated AI schema, leading to validation warnings or errors in Demo Mode.
**Resolution**: **FIXED**. Synchronized `MockDataGenerator` logic with the latest `product.json` schema requirements (especially regarding the newly added `category`, `active`, and `allowBackOrder` fields).

---

## 21. Regression Analysis & Batch Engine Reliability (Feb 25)

### [x] Investigate Liferay 400 Error on `import-task` (PRIORITY 1 - High Impact, Moderate Fix)
**Issue**: The microservice intermittently receives `400 Bad Request` with message `The service parameter was not provided by this object` when calling `GET /o/headless-batch-engine/v1.0/import-task/{id}` immediately after a batch submission.
**Resolution**: **FIXED**. Added a retry/backoff mechanism in `LiferayRestService.getImportTask` specifically for HTTP 400 errors to handle the race condition in Liferay task initialization.

### [ ] Fix SKU Batch Conflict / Redundancy (PRIORITY 2 - High Impact, Moderate Fix)
**Issue**: Multiple `product-skus` batches are being submitted simultaneously. Some fail or cause Liferay errors. The query parameters `productId` and `externalReferenceCode` are both being passed to the Catalog SKU batch endpoint, which might be redundant or conflicting.
**Resolution**: Investigate and audit `ProductGenerator.startProductsBatch` and `LiferayService.createSkusBatch`. Ensure only the necessary identifier is used.

### [ ] Stabilize WebSocket Correlation (`cid=unknown`) (PRIORITY 3 - Medium Impact, Moderate Fix)
**Issue**: Logs show `cid=unknown` for many WebSocket events, and `sent=0/0` indicating no clients are receiving updates for certain batches. This suggests the `correlationId` is being lost between the initial submission and the callback processing.
**Resolution**: Verify that the `correlationId` is correctly extracted from the `callbackURL` query parameters in `routes/batch.cjs` and consistently passed through `BatchCallbackService`.

---

---

## 24. Workflow Continuation & Pricing Fixes (Feb 25)

### [x] Fix Pricing Workflow Stall (stepKey Mismatch)
**Analysis**: When a pricing step (Standard, Bulk, or Tiered) has no items to process, it incorrectly creates a terminal batch marker with `stepKey: 'status'`. The `BatchCallbackService` expects the marker to match the current step's name (e.g., `generate-price-lists`). This mismatch causes the orchestrator to wait indefinitely for a non-existent batch, stalling the entire workflow and preventing subsequent steps (attachments, inventory, accounts, orders) from running.
**Approach**: Updated `ProductGenerator._runPricingStep` to correctly use the dynamic `stepKey` when creating synchronous terminal markers.
**Result**: **FIXED**.

### [x] Verify Price Entry Distribution Logic
**Analysis**: The current `filterFn` in pricing steps (`generate-price-lists`, `generate-bulk-pricing`, `generate-tier-pricing`) is mutually exclusive. Products with tiered pricing are skipped in the "Standard" step. If all products happen to be tiered, the standard step will be empty, potentially triggering the stall bug.
**Approach**: Verified that the distribution ratios in `MockDataGenerator` and the filters in `ProductGenerator` provide a consistent coverage of products across the three pricing steps. Consolidating the steps is not necessary as the stall fix allows the workflow to proceed through empty steps.
**Result**: **VERIFIED**.

### [x] Resolve Attachment and Inventory Bypass
**Analysis**: The user reported missing images, PDFs, and inventory updates. These steps are currently scheduled *after* the pricing steps in a `parallel` block. If the pricing steps stall, these "post-processing" steps are never initiated.
**Approach**: Fixing the pricing stall (Task 1) naturally resolved the bypass of these downstream steps.
**Result**: **FIXED**.

