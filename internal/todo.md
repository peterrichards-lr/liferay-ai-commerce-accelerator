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
**Result**: \*\*FIXED`.

---

## 3. System Stability

### [x] Handle Shutdown Exceptions (`write EPIPE`)

**Result**: \*\*FIXED`.

### [x] Improve Error Message Clarity (Remove 'undefined' references)

**Result**: \*\*FIXED`.

---

## 4. Discovery Enhancements (Standardization)

### [x] Extend Query-Level Exclusions

**Result**: \*\*FIXED`.

---

## 5. Runtime Exceptions (Reported)

### [x] GraphQL DataFetchingException (Specifications)

**Analysis**: The `product-data-generation` step was encountering intermittent `DataFetchingException` (500 Internal Server Error) when querying Liferay's GraphQL endpoint for specifications.
**Result**: \*\*FIXED`.

### [x] Persistent Warehouse Resolution Failure (STALE_INDEX)

**Analysis**: Despite a 12-attempt retry loop, `resolve-warehouse-ids` was still timing out with `STALE_INDEX`.
**Result**: \*\*FIXED`.

### [x] GraphQL DataFetchingException (Accounts Discovery)

**Analysis**: The `deleteAccounts` step was consistently failing with `DataFetchingException: null` in Liferay's GraphQL layer.
**Result**: \*\*FIXED`.

### [x] Redundant "Step completed" Logging (Loop Atomicity)

**Analysis**: Step completion was being logged and emitted multiple times for fast synchronous steps.
**Result**: \*\*FIXED`.

### [x] Graceful Shutdown Logger Failure (write EPIPE)

**Analysis**: During process termination (SIGTERM/SIGINT), the logger throws an uncaught `EPIPE` error when trying to write to `process.stdout` or `stderr`.
**Result**: \*\*FIXED`.

### [x] Missing Context IDs in Full Deletion

**Analysis**: The "Full environment deletion" process (triggered via `runDeleteAndMonitor`) does not explicitly populate `channelId` and `catalogId` at the root of the session context.
**Result**: \*\*FIXED`.

### [x] Fix Product Inventory Update Schema Mismatch

**Analysis**: The `update-product-inventory` operation was failing with a 400 Bad Request.
**Result**: \*\*FIXED`.

---

## 6. Verification Tasks

### [x] Verify redundant `_checkSessionCompletion` removal

**Result**: \*\*VERIFIED`.

---

## 66. Admin Experience & Robustness (May 4)

### [x] Implement Resumable Flows (localStorage)

**Analysis**: Page refreshes were causing the UI to lose track of active background jobs.
**Result**: **FIXED**. Integrated localStorage to persist the active session ID.

### [x] Implement Workflow Cancellation

**Analysis**: No way for users to stop a mistakenly started job without a server restart.
**Result**: **FIXED**. Added backend cancel endpoint and frontend 'Cancel' button.

### [x] Implement Admin Dashboard (Second Fragment)

**Analysis**: Administrators need a dedicated view for session history, KPIs, and troubleshooting.
**Result**: **FIXED**. Created a new Custom Element and Fragment for the Admin Dashboard.

### [x] Configuration Doctor (Diagnostics)

**Analysis**: Users were hitting errors (like missing API keys) that weren't discovered until runtime.
**Result**: **FIXED**. Built a diagnostic method that verifies API keys, prompts, and schemas before generation begins.

---

## 67. Strategic Roadmap (Current)

### [x] 1. Detailed Failure Modal in Admin Dashboard

**Rationale**: While the Admin Dashboard shows that a session failed, users need to see the exact stack trace or Liferay error response to self-serve a fix.
**Result**: **FIXED**. Added `error_stack` support to `PersistenceService`, `ProgressService`, and `BaseGenerator`. Updated `SessionDetailModal` to show expandable stack traces and detailed Liferay error reports in the audit trail.

### [x] 2. Dataset Import Logic (Server-side)

**Rationale**: Currently, 'Import Dataset' is a client-side placeholder. Implementing the backend logic to ingest this JSON and trigger creation steps is the final piece of the environmental parity goal.
**Result**: **FIXED**. Refactored `import.cjs` to use the `WorkflowCoordinator` and updated generators to support 'Import Mode'. Added unit tests and E2E verification.

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
**Result**: \*\*FIXED`.

### [x] Warehouse Deletion Failure (Referential Integrity)

**Analysis**: Deleting warehouses failed because associated inventory items (WarehouseItems) were still present, violating referential integrity.
**Result**: \*\*FIXED`.

---

## 9. Recent Runtime Stability & Bug Fixes

### [x] Missing `createWarehouseItemsBatch` Delegation

**Analysis**: The `LiferayService` facade in `index.cjs` is missing the `createWarehouseItemsBatch` method, which is implemented in `rest.cjs`. This causes a `TypeError` when the inventory update step attempts to call the method.
**Result**: \*\*FIXED`.

### [x] Fix Batch Callback Crash (`failureDetails` Undefined)

**Analysis**: The orchestrator crashes with `Cannot read properties of undefined (reading 'slice')` if `liferay.getImportTaskFailedItemReport` returns `undefined` (which can happen on network errors or unexpected API responses).
**Result**: \*\*FIXED`.

### [x] Media Generator Fallback Fix (parseDataUrl)

**Analysis**: `MediaGenerator` fails with `parseDataUrl: input must be a string` when `ConfigService` returns `null` for a default image or PDF. It incorrectly passes `null` to the utility function instead of using the fallback immediately.
**Result**: \*\*FIXED`.

### [x] Fix `Invalid URL` in Image Creation

**Analysis**: `MediaGenerator.createImages` attempts to fetch image data via `axios.get(imageData.src)` without validating that `src` is a valid URL. AI-generated or malformed data can trigger an `Invalid URL` exception.
**Result**: \*\*FIXED`.

### [x] Investigate Warehouse Deletion 500 Error

**Analysis**: Sequential `DELETE` requests for warehouses were encountering `500 Internal Server Error` (specifically `StaleStateException`) because the `deleteWarehouseItems` step was running immediately before it. Liferay's internal warehouse deletion logic attempts to clean up associated items; if they are already gone, Hibernate throws a stale state exception.
**Result**: \*\*FIXED`. Reordered deletion workflow to run `deleteOrders`first, then`deleteWarehouses`(which handles its own items), and removed the redundant`deleteWarehouseItems` from the full deletion flow.

### [x] Fix Inventory ERC Duplication (Truncation Bug)

**Analysis**: `ProductGenerator._runUpdateInventoryStep` used `sanitizeForERC` which truncated strings to 12 characters by default. The inventory ERC pattern `AICA-INV-[warehouseERC]-[sku]` resulted in non-unique ERCs for different variant SKUs of the same product because their sanitized prefixes were identical.
**Result**: \*\*FIXED`.

### [x] Handle Local Assets in Image Attachment (Demo Mode)

**Analysis**: In demo mode, `MockDataGenerator` used `default.webp` as the image source. `MediaGenerator.createImages` skipped it because it failed the `isValidUrl` check.
**Result**: \*\*FIXED`.

---

## 10. Pricing & Data Generation Fixes (Feb 24)

### [x] Fix Product Options Linking and Variant Creation

**Analysis**: Options were not appearing on products, and variants were not being created despite being generated in the context. Additionally, a ReferenceError was crashing the inventory update.
**Result**: \*\*FIXED`.

### [x] Fix SKU Validation Exception (Unrecognized field "active")

**Analysis**: The `Sku` DTO in Liferay Headless Commerce API (v1.0) does not recognize an `active` property.
**Result**: \*\*FIXED`.

---

## 11. Orchestration & State Fixes (Feb 24)

### [x] Resolve Session Completion Race Condition

**Analysis**: Multiple `Workflow session completed` events were emitted for a single session.
**Result**: \*\*FIXED`.

### [x] Enforce Workflow Failure Policy

**Analysis**: Sessions were marked as `COMPLETED` even when synchronous steps failed.
**Result**: \*\*FIXED`.

---

## 12. Strategic Roadmap (Completed Feb 24)

### [x] Fix `OrderGenerator` Signature Mismatch (PRIORITY 1)

**Analysis**: `OrderGenerator.getProductsAndAccounts` was passing raw IDs instead of options objects, and incorrectly processing result items.
**Result**: \*\*FIXED`.

### [x] Consistent `correlationId` Propagation (PRIORITY 2)

**Analysis**: WebSocket messages were missing `correlationId` due to inconsistent argument patterns between `ProgressService` and `WebSocketService`.
**Result**: \*\*FIXED`. Standardized propagation in both services.

### [x] Align Event Types and UI Handling (PRIORITY 2)

**Analysis**: UI was resetting progress counts on batch-level `STARTED` events and not accumulating progress correctly. `normalizeEntityType` was missing several step keys.
**Result**: \*\*FIXED`. Updated `useRealtimeWebSocket.js`to track individual batch progress and`normalizeEntityType` to support all keys.

### [x] Account Address Linking `STALE_INDEX` Failure (PRIORITY 3)

**Analysis**: Newly created accounts/addresses were not immediately searchable via GraphQL due to indexing lag.
**Result**: \*\*FIXED`. Implemented resilient retry logic in `AccountGenerator`.

### [x] Graceful Database Shutdown (PRIORITY 3)

**Analysis**: SQLite connection should be closed during server shutdown to prevent file corruption.
**Result**: \*\*FIXED`. Updated `PersistenceService`and`server.cjs`.

### [x] Implement Workflow Summary API (PRIORITY 4)

**Objective**: Allow callers to retrieve a detailed summary of a specific workflow session, including steps, timings, and events.
**Result**: \*\*FIXED`. Added `getEventsForSession`, path constant, and summary GET route.

### [x] Standardize Resilient Discovery Across Generators (PRIORITY 5)

**Analysis**: Inconsistent retry patterns across generators.
**Result**: \*\*FIXED`. Extracted `liferay.resolveByERCsWithRetry` utility and refactored generators to use it.

### [x] Improve GraphQL SDK Error Handling (PRIORITY 5)

**Analysis**: GraphQL error arrays were ignored by the `STALE_INDEX` check.
**Result**: \*\*FIXED`. Updated `LiferayGraphQLService.\_fetchByERCs`.

### [x] Enhance Cache Coordination in `PersistenceService` (PRIORITY 5)

**Analysis**: `PersistenceService` lacked paged list caching for batches.
**Result**: \*\*FIXED`. Implemented read-through caching for `getBatchesForSession`.

### [x] Add Database Indexes for Performance (PRIORITY 5)

**Analysis**: Queries by `session_id` would slow down as tables grow.
**Result**: \*\*FIXED`. Added indexes on `session_id` for batches and events tables.

### [x] Improve Asynchronous Traceability (Correlation ID)

**Analysis**: Batch callbacks from Liferay were missing `correlationId`, making it difficult to trace logs back to the originating UI session. Outgoing API logs also lacked this context.
**Result**: \*\*FIXED`. Added `correlationId` to batch callback URLs, updated middleware to handle it from querystring, and ensured all internal and outgoing logs include it.

---

## 13. Stability & Utility Fixes (Feb 24 Continued)

### [x] Fix `delay is not defined` ReferenceError in LiferayService

**Analysis**: The `resolveByERCsWithRetry` method in `services/liferay/index.cjs` uses the `delay` function for retries, but it was not imported. This caused any step using this utility (like resolving IDs for products, accounts, or addresses) to crash immediately upon encountering a `STALE_INDEX` error from Liferay.
**Result**: \*\*FIXED`. Added import for `delay`from`../../utils/misc.cjs`.

### [x] Reduce GraphQL Error Noise in Logs

**Analysis**: `LiferayGraphQLService._fetchByERCs` logged all GraphQL errors as `ERROR` level. During data generation, `DataFetchingException` (404 Not Found) is a common and expected condition caused by Liferay's indexing lag. These were cluttering the logs.
**Result**: \*\*FIXED`. Modified `\_fetchByERCs`to log missing entity errors at`DEBUG` level and provide a more informative message.

### [x] Verify `set-billing-and-shipping-addresses` Step Logic

**Analysis**: This step was verified in a live run. While the `delay` ReferenceError is resolved, the step still fails with `STALE_INDEX` after 12 retries (60s) for large data sets. Investigation revealed redundant nested retries between the facade and GraphQL services, causing excessive log volume.
**Result**: \*\*ANALYZED & PARTIALLY FIXED`. Logical errors resolved, but performance/scalability issues identified (see Section 16).

---

## 14. Batch Callback & Verification Fixes (Feb 24)

### [x] Verify Batch Terminal Status and Counts After Callback

**Analysis**: The `BatchCallbackService.processCallback` method was assuming the callback payload's status was the final and complete state. However, Liferay's REST API status (`executeStatus`) and item counts (`processedItemsCount`, `totalItemsCount`) may lag behind the callback or be sent while the task is still technically "STARTED". Additionally, a bug in count extraction (`importTask?.data || importTask`) resulted in 0 counts if the response body was the object itself.
**Result**: \*\*FIXED`. Added a short polling loop to verify `executeStatus`is`COMPLETED`or`FAILED` before proceeding, corrected the count extraction logic, and standardized status resolution between the callback and the REST API.

### [x] Implement Missing `getBatchStatus` API

**Analysis**: The `GET /api/v1/batch/status/:batchId` route was calling a non-existent method on `BatchCallbackService`, leading to a crash.
**Result**: \*\*FIXED`. Added `getBatchStatus`to`BatchCallbackService`and`getBatchByDownstreamId`to`PersistenceService`.

---

## 16. SDK Refinement & Scalability (Feb 25)

### [x] Consolidate Redundant Retry Logic (STALE_INDEX)

**Analysis**: Both `LiferayService.resolveByERCsWithRetry` and `LiferayGraphQLService._executeWithRetry` implement independent retry loops for handling Liferay's indexing lag. This leads to nested retries (e.g., 12 \* 12 = 144 attempts), excessive log bloat, and masked failure roots.
**Result**: \*\*FIXED`. Standardized on a single retry mechanism within the GraphQL service (10 attempts, exponential backoff). Refactored the facade to remove its redundant loop.

### [x] Complete `correlationId` Propagation in SDK Logs

**Analysis**: Many internal logs in `rest.cjs` and `graphql.cjs` (especially Response and Retry logs) still default to `"correlationId": "system"` because the CID is not explicitly passed to the logger metadata.
**Result**: \*\*FIXED`. Updated `\_request`in`rest.cjs`and all fetchers in`graphql.cjs`to explicitly include`correlationId` from the request config.

### [x] Increase Indexing Resilience for Large Data Sets

**Analysis**: Even with retries, the final address association step fails when large numbers of accounts and addresses are created simultaneously, as Liferay's index consistency can take longer than the current 60s window.
**Result**: \*\*FIXED`. Implemented `resolve-account-ids`step in`AccountGenerator`to wait for account indexing before proceeding to addresses. Refactored`postal-addresses` to use these resolved IDs from context, ensuring no accounts are skipped during the association phase. Increased default retry timeout and backoff in the GraphQL layer.

---

## 17. Deletion Discovery & Sequencing Fixes (Feb 25)

### [x] Fix Account Deletion Discovery (Relational Dependency)

**Analysis**: `LiferayService.getAccounts` relied on querying existing orders to discover accounts when a `channelId` was provided. Since orders are deleted first in the workflow, this discovery returned zero results, causing account deletion to be silently skipped.
**Result**: \*\*FIXED`. Updated `getAccounts` to prioritize prefix-based discovery (`externalReferenceCode sw 'AICA-ACC'`) when a search term is provided, ensuring accounts are found even after orders are removed.

---

## 19. Current Failures & Regression Fixes (Feb 25)

### [x] Fix Product Schema for `promoPrice` (PRIORITY 1 - High Impact, Easy Fix)

**Issue**: The `product-data-generation` step fails with `Mock product data failed schema validation: must be number` for `/products/0/priceEntries/0/promoPrice`. This happens because the schema requires a `number` but the generator (and AI) often provides `null` for products without active promotions.
**Resolution**: \*\*FIXED`. Updated `ai-schemas/product.json`to allow`null`for`promoPrice`at both the`priceEntry`and`tierPrice`levels by using`["number", "null"]` for the type.

### [x] Robust Workflow Failure Propagation (PRIORITY 2 - High Impact, Moderate Fix)

**Issue**: When `product-data-generation` fails (e.g., due to the validation error above), the workflow logs the error but the session remains in a "zombie" state or is silently skipped instead of being marked as `FAILED`. The UI is not notified of the specific failure.
**Resolution**: \*\*FIXED`. Updated `ProductGenerator.\_runProductDataGenerationStep`and`BatchCallbackService`to ensure that any exception in a synchronous step handler triggers`persistence.tryFailSession`and emits a`session_failed` WebSocket event.

### [x] Deduplicate Shutdown Signal Handlers (PRIORITY 3 - Medium Impact, Easy Fix)

**Issue**: Logs show redundant `SIGTERM received` and `Database connection closed` messages during shutdown. This indicates that handlers in `server.cjs` might be registered multiple times (e.g., inside and outside the async IIFE) or that the sequence is being triggered twice.
**Resolution**: \*\*FIXED`. Audited `server.cjs`and ensured signal handlers are registered exactly once using`process.once`.

### [x] Refine `MockDataGenerator` Schema Adherence (PRIORITY 4 - Medium Impact, Easy Fix)

**Issue**: The `MockDataGenerator` might be producing data structures that deviate slightly from the recently updated AI schema, leading to validation warnings or errors in Demo Mode.
**Resolution**: \*\*FIXED`. Synchronized `MockDataGenerator`logic with the latest`product.json`schema requirements (especially regarding the newly added`category`, `active`, and `allowBackOrder` fields).

---

## 21. Regression Analysis & Batch Engine Reliability (Feb 25)

### [x] Investigate Liferay 400 Error on `import-task` (PRIORITY 1 - High Impact, Moderate Fix)

**Issue**: The microservice intermittently receives `400 Bad Request` with message `The service parameter was not provided by this object` when calling `GET /o/headless-batch-engine/v1_0/import-task/{id}` immediately after a batch submission.
**Resolution**: \*\*FIXED`. Added a retry/backoff mechanism in `LiferayRestService.getImportTask` specifically for HTTP 400 errors to handle the race condition in Liferay task initialization.

### [x] Fix SKU Batch Conflict / Redundancy (PRIORITY 2 - High Impact, Moderate Fix)

**Issue**: Multiple `product-skus` batches were being submitted simultaneously. The query parameters `productId` and `externalReferenceCode` were both being passed to the Catalog SKU batch endpoint, which was redundant.
**Result**: \*\*FIXED`. Updated `liferayPaths.cjs`to ensure only one identifier is passed to scoped batch endpoints. Verified that`ProductGenerator` uses efficient product-level UPSERTs for SKUs.

### [x] Stabilize WebSocket Correlation (`cid=unknown`) (PRIORITY 3 - Medium Impact, Moderate Fix)

**Issue**: Logs showed `cid=unknown` for many WebSocket events, and `sent=0/0` because the `correlationId` was being lost or overridden by middleware-generated UUIDs during callbacks.
**Result**: \*\*FIXED`. Removed the `'unknown'`fallback in`ProgressService`and updated`routes/batch.cjs`to use the CID from the query string if present, allowing correct fallback to the session's stored CID. This restored proper targeting in`WebSocketService`.

---

---

## 25. Log Analysis & Post-Processing Fixes (Feb 26)

### [x] Fix Malformed Pricing Batch URL (404 Error)

**Analysis**: `PATH.PRICE_LIST_PRICE_ENTRIES_BATCH` in `utils/liferayPaths.cjs` incorrectly used the `/by-externalReferenceCode/` path segment. Pricing V2.0 Batch Engine endpoints do not support this structure for price entries, resulting in a `404 Not Found`.
**Result**: \*\*FIXED`. Updated `liferayPaths.cjs`to use the standard`/price-entries/batch`path. Scoping is correctly handled via the`priceListExternalReferenceCode` property within each item.

### [x] Restore `correlationId` Traceability in Background Steps

**Analysis**: Logs for generator steps often showed `"correlationId": "system"` because the CID from the session context was not consistently passed to logger calls during background execution.
**Result**: \*\*FIXED`. Updated `BatchCallbackService`to consistently propagate`correlationId`to step handlers. Refactored`ProductGenerator`, `AccountGenerator`, `OrderGenerator`, and `MediaGenerator`to include`correlationId`in all`logger` calls, ensuring full asynchronous traceability.

### [x] Audit and Standardize Log Levels (Chattiness Review)

**Analysis**: Previous logging was verbose at the `INFO` level, making the microservice too chatty during large data generation runs.
**Result**: \*\*FIXED`. Established a standardized logging policy: `INFO`for lifecycle events,`DEBUG`for operational milestones (batches, resolutions), and`TRACE`for granular loops. Audited and demoted logs across`rest.cjs`, `ProductGenerator`, `AccountGenerator`, and other core services.

---

## 29. Pricing Reliability & Orchestrator Traceability (Feb 26 - Round 5)

### [x] Use Numeric IDs for Price Entry Batch Scoping

**Analysis**: Batch submissions using ERCs for price list scoping were failing due to indexing lag. Liferay's API is more reliable when using numeric IDs.
**Result**: \*\*FIXED`. Updated `ProductGenerator` to capture numeric IDs during Price List retrieval and use them in both the item payload (`priceListId`) and the batch query parameters.

### [x] Complete Missing `correlationId` in `BatchCallbackService`

**Analysis**: Several orchestrator logs were missing the session CID, breaking the traceability chain.
**Result**: \*\*FIXED`. Audited and updated all logger calls in `BatchCallbackService`to consistently include`correlationId`.

### [x] Standardize Soft Fallback for Price List Discovery

**Analysis**: Existence checks for price lists were logging 404s as errors.
**Result**: \*\*FIXED`. Registered `get-price-list-by-erc`as a soft status operation in`rest.cjs`, demoting 404 logs to INFO.

---

## 30. Soft Fallback Regression & Batch Scoping Conflict (Feb 26 - Round 6)

### [x] Fix Soft Fallback Regression in `_ensurePriceLists`

**Analysis**: Commit S introduced a soft fallback that returned an object instead of `null` on 404. The generator incorrectly treated this as a "found" price list, skipping creation.
**Result**: \*\*FIXED`. Updated `getPriceListByERC`to return`null`if the result has`softEmpty: true`.

### [x] Resolve Batch Query Parameter Conflict

**Analysis**: Passing Price List identifiers in the batch URL query string caused Liferay to attempt using them as the ERC for the _ImportTask_, leading to collisions.
**Result**: \*\*FIXED`. Removed query parameters from `PRICE_LIST_PRICE_ENTRIES_BATCH`in`liferayPaths.cjs`. Scoping is now correctly handled via item-level properties in the batch body.

---

## 36. Atomic Price List & Nested Entry Processing (Feb 26 - Round 12)

### [x] Implement Atomic Price List Updates

**Analysis**: Submitting price entries to the scoped `/price-lists/price-entries/batch` endpoint proved unreliable due to Liferay's strict requirement for an `externalReferenceCode` query parameter, which consistently collided with the `ImportTask` itself or the Price List entity.
**Result**: \*\*FIXED`. Refactored `ProductGenerator`to use the atomic update pattern. It now constructs full`PriceList`objects containing the`priceEntries`collection and submits them to the global`/price-lists/batch` endpoint. This avoids all scoping and ERC collision issues.

### [x] Complete Traceability Audit in SDK

**Analysis**: Identified remaining logs in `LiferayRestService` that were still missing the `correlationId`.
**Result**: \*\*FIXED`. Audited and updated `\_request`and`\_postBatch` to consistently include the CID in all log levels.

---

## 40. Resilient SKU & Pricing Integration (Feb 26 - Round 13)

### [x] Explicit SKU Creation for All Products

**Analysis**: Simple products currently rely on auto-created SKUs, leading to `NoSuchCPInstanceException` when Pricing V2.0 tries to find them by ERC.
**Result**: \*\*FIXED`. Updated generators to always include an explicit SKU object with a trackable ERC in the initial creation batch.

### [x] Direct SKU Batching for Variable Products

**Analysis**: Adding SKUs via Product Batch UPSERT is unreliable for complex variants.
**Plan**: Refactor `product-skus` step to use the dedicated SKU Batch API (`/products/{id}/skus/batch`) with numeric `productId` scoping.
**Result**: \*\*REVERTED`. This approach failed due to a `NotSupportedException`. Reverted to using the atomic Product Batch UPSERT, which is now more reliable due to other fixes.

### [x] Enforced Numeric IDs in Pricing

**Analysis**: Relying on ERC search for pricing is slow and prone to indexing lag.
**Result**: \*\*FIXED`. Update `\_runPricingStep`to use resolved numeric`skuId`and`priceListId`, omitting ERCs where possible.

### [x] Standardize Scoping Parameters for Specialized Batch Endpoints

**Analysis**: Specialized batch endpoints (Catalog SKUs, Inventory) failed with `NotSupportedException` because they strictly require `externalReferenceCode` for parent scoping and do not recognize `productId` or `warehouseId` query parameters, despite their naming in the API.
**Result**: \*\*REVERTED`. This assumption was incorrect. Reverted path helpers and now relying on atomic parent-level batch updates.

---

## 41. Schema Validation & AI Prompt Updates (Feb 27 - Round 14)

### [x] Align SKU ERC in `MockDataGenerator`

**Analysis**: The `MockDataGenerator` was generating price entries using a descriptive SKU code (`sku`) but the underlying SKU's `externalReferenceCode` was being set to the parent product's ERC by Liferay, causing `NoSuchCPInstanceException`.
**Result**: \*\*FIXED`. Ensured that for simple products, the base SKU's `externalReferenceCode`is explicitly set to its descriptive`sku` code, and price entries correctly reference this.

### [x] Align SKU ERC in `ProductGenerator` Fallback

**Analysis**: The fallback SKU creation in `ProductGenerator` was omitting the `externalReferenceCode` for base SKUs, leading to an ERC mismatch with price entries.
**Result**: \*\*FIXED`. Explicitly set the base SKU's `externalReferenceCode`to its descriptive`sku` code.

### [x] Make SKU `externalReferenceCode` Required in Schema

**Analysis**: The `product.json` schema was updated to make `externalReferenceCode` optional for SKUs, but the corrected generator logic requires it.
**Result**: \*\*FIXED`. Reverted the schema change to make `externalReferenceCode` required for SKUs.

### [x] Update AI Prompt Instructions

**Analysis**: The AI prompt did not correctly instruct the AI on how to generate `externalReferenceCode` for SKUs, leading to schema validation failures.
**Result**: \*\*FIXED`. Instructed the AI to always set `externalReferenceCode`to be the same as the`sku` code for all SKUs (base and variants).

---

## 42. OAuth Configuration Error (Feb 27 - Round 15)

### [x] Refactor `OAuthService` Initialization

**Analysis**: `TypeError: Cannot read properties of undefined (reading 'tokenUri')` occurred at module load time in `oauth.cjs` because `serverOauthApp` was being accessed before `ctx.logger` was available in the constructor.
**Result**: \*\*FIXED`. Moved `serverOauthApp`initialization into the`OAuthService`constructor, ensuring`ctx.logger` is available for error handling.

---

## 43. Inter-Service Synchronization (Feb 27 - Round 16)

### [x] Introduce Liferay Inter-Service Synchronization Delay

**Analysis**: Persistent `NoSuchCPInstanceException` errors for SKUs might be due to a race condition where the Pricing service's view of the catalog lags behind the Catalog service itself.
**Result**: \*\*FIXED`. Introduced a configurable delay after SKU resolution (and before pricing steps) to allow for inter-service synchronization.

---

## 44. Restore Full Logging (Feb 27 - Round 17)

### [x] Correct Logger Configuration

**Analysis**: The logger was not displaying full output because `logger.cjs` referenced `ENV.LOGGER_LEVEL` which was `undefined`, causing it to default to a restricted logging level. Missing metadata `NODE_ENV`, `SERVICE_NAME`, and `SERVICE_VERSION` were also noted.
**Result**: **FIXED**. Corrected typo to `ENV.LOG_LEVEL` in `logger.cjs` and added definitions for `NODE_ENV`, `SERVICE_NAME`, and `SERVICE_VERSION` to `constants.cjs`.

---

## 45. Post-Squash Stability & Data Integrity (Feb 27 - Round 18)

### [x] Fix Account Generation Crash (Empty Country List)

**Issue**: The 'account-data-generation' step crashes with 'Cannot read properties of undefined (reading "id")' when 'load-countries' returns an empty list.
**Analysis**: The generator tries to pick a random country from the fetched list without checking if the list is empty. Additionally, we need to investigate why 'getCountries' intermittently returns 0 results despite previous success.
**Result**: **FIXED**. Added defensive guards and default "United States" fallback in 'AccountGenerator' and 'MockDataGenerator'. Improved 'asCount' to handle missing 'totalCount' and 'items' array.

### [x] Investigate Persistent Catalog Configuration Failure

**Issue**: The 'update-catalog-configuration' step reports 200 OK for its PATCH requests, but the catalog still reflects the old 'Master' price lists as base in Liferay.
**Analysis**: Liferay Commerce strictly allows only one base list per catalog/type. Concurrent or un-sequenced patches can lead to the state being rejected or overwritten.
**Result**: **FIXED**. Implemented aggressive unsetting phase that identifies and clears ALL other base lists for the catalog before setting AICA lists. Increased delays to 2s and added a final verification phase with explicit error logging.

### [x] Robust Handover in Deletion

**Issue**: Price list deletion still encounters referential integrity errors.
**Analysis**: The discovery logic for the 'Master' lists to restore might be failing because of exact name matches or case sensitivity.
**Result**: **FIXED**. Updated 'resetCatalogConfiguration' step to be the mandatory first phase of deletion. It independently restores both standard and promotional master lists using robust name-based matching.

### [x] Standardize ERC Generation across Batches

**Issue**: Some logs still show 'undefined' prefixes for batch ERCs.
**Analysis**: Missing mappings in 'ERC_PREFIX' or inconsistent usage of 'createERC'.
**Result**: **FIXED**. Completed audit of 'createERC' and 'ERC_PREFIX'. Added 'BATCH_DELETION' and 'BATCH_GENERATION' to the central constants.

---

## 46. Emergency Recovery (Feb 28)

### [x] Fix Regression: Missing Mock Data Methods (PRIORITY 1)

**Issue**: The generation workflow fails in Demo Mode with `mockData.generateWarehouseData is not a function`.
**Analysis**: The `MockDataGenerator` was missing implementation for `generateWarehouseData` and `generateOrderData`, which are called by `WarehouseGenerator` and `OrderGenerator` respectively.
**Result**: **FIXED**.

### [x] Fix Regression: GraphQL `DataFetchingException: null` for Accounts (PRIORITY 1)

**Issue**: The `deleteAccounts` step fails with a GraphQL 500 error: `Exception while fetching data (/headlessAdminUser_v1_0/accounts) : null`.
**Analysis**: The `headlessAdminUser_v1_0` API appeared to reject the `sw` (Starts With) operator in the OData filter. This results in a null response from Liferay's data fetcher.
**Result**: **FIXED**.

### [x] Audit Missing `mockData` calls in all Generators (PRIORITY 2)

**Issue**: Other generators might also have broken demo modes if they rely on missing `MockDataGenerator` methods.
**Analysis**: Audited all generators and confirmed that all `mockData` calls now have corresponding implementations in `MockDataGenerator.cjs`.
**Result**: **FIXED**.

---

## 47. Workflow & Hook Stability (Feb 28 - Round 2)

### [x] Fix Account Creation Address Regression

**Issue**: Account creation was incorrectly including nested addresses in the initial batch, which is not supported for new accounts.
**Analysis**: The generator was sending `billingAddress`, `shippingAddress`, and `headOfficeAddress` within the `Account` DTO. This bypassed the required multi-step process: (1) Create Account, (2) Create Postal Addresses, (3) Link Defaults.
**Result**: **FIXED**. Refactored `AccountGenerator.cjs` to strictly clean the account payload and group addresses for per-account batching.

### [x] Fix Pre-commit Hook Execution

**Issue**: The Git pre-commit hook failed to execute or could not find `npx`.
**Analysis**:

1. The `.husky/pre-commit` file was initially created without the executable bit.
2. In some environments (especially non-interactive shells used by Git), `npx` was not in the `PATH`.
3. Local environment uses Maven-managed Node (located in `build/node/bin`).
   **Result**: **FIXED**. Applied `chmod +x` and updated the hook script to prioritize project-local Node binaries and support `~/.huskyrc` for user-specific environment configuration.

---

## 48. Workflow Resilience & Race Condition Fixes (Feb 28 - Round 3)

### [x] Fix Postal Address Callback Race Condition

**Issue**: The workflow stalled during address creation with "No batch record found for batchERC in callback" errors in the logs.
**Analysis**:

1. `_runAddressCreationStep` was submitting multiple batches but only persisting after the loop.
2. Callback arrives before SQLite write is visible to the callback handler thread/process.
3. Query parameter naming mismatch between `liferayPaths.cjs` and `routes/batch.cjs`.
   **Result**: **FIXED**.

- Refactored `AccountGenerator.cjs` to persist records _before_ submission.
- Enhanced `PersistenceService.cjs` to proactively populate the in-memory cache during `createBatch`.
- Added a retry mechanism in `BatchCallbackService.processCallback` to wait for records that are mid-commit.
- Updated `routes/batch.cjs` to accept both `batchExternalReferenceCode` and `batchERC` parameters.

## 50. Robust Discovery & OData Removal (Mar 1)

### [x] Eliminate `sw` and `startswith()` Operators (PRIORITY 1)

**Issue**: Liferay's `headlessAdminUser_v1_0` GraphQL fetcher crashes with a 500 error (`null` response) when using the `sw` or `startswith()` operators.
**Analysis**: These string operators are inconsistently supported and unreliable for discovery. The user has explicitly forbidden their use.
**Result**: **FIXED**. Removed `prefixFilter` from the OData `filter` string in `LiferayService.getAccounts` and implemented JS memory filtering to verify the `AICA-` prefix on returned items.

### [x] Restore Deletion Workflow Reliability (PRIORITY 1)

**Issue**: The `deleteAccounts` step is failing due to the broken `sw` operator, preventing environment cleanup.
**Analysis**: Discovery must be able to find AICA-created accounts even when they are not linked to orders.
**Result**: **FIXED**. Updated `deleteAccounts` handler in `BatchCallbackService` to fetch a larger page size (200) and pass the `search` parameter to ensure AICA accounts are captured without an OData prefix filter.

### [x] Implement Mutating Cache Invalidation (REST SDK) (PRIORITY 1)

**Issue**: Verification steps (like checking if a Price List is base after a `PATCH`) are failing because they hit the stale API response cache from earlier in the same workflow.
**Analysis**: Initial analysis suspected `LiferayRestService._get` used a response cache that wasn't invalidated. Further investigation revealed there is NO API response cache for generic GET calls; the `Cache hit` logs were for OAuth tokens and configuration. The verification failure was purely due to Liferay persistence lag.
**Result**: **VOID**. Task abandoned due to false premise. Verification issue resolved via polling loop.

### [x] Correct Price List Verification Logic (PRIORITY 2)

**Issue**: Logs show `VERIFICATION FAILED` for AICA Price Lists despite potential success.
**Analysis**: The verification logic was too strict and timing-sensitive, failing due to Liferay's internal asynchronous indexing/persistence lag after a `PATCH`.
**Result**: **FIXED**. Implemented a polling loop for the final base status check in `_runUpdateCatalogConfigurationStep`.

### [x] Robust Master Price List Discovery (PRIORITY 2)

**Issue**: Warnings show "Could not find a master price list to restore".
**Analysis**: The current logic relies on finding a list with "master" in the name or the `catalogBasePriceList` flag. If AICA lists are already base, and no other list has "master" in the name, restoration fails.
**Result**: **FIXED**. Improved discovery logic in `resetCatalogConfiguration.cjs` to fallback to the first available non-AICA list if no explicitly named 'master' or 'default' list is found.

---

## 51. Attachment & Order Generation Stabilisation (Mar 1 - Round 2)

### [x] Correct Step Dependencies in Combined Generation (PRIORITY 1)

**Issue**: `order-data-generation` starts before products and accounts are fully ready, leading to "No accounts available" or missing product links.
**Analysis**: The generation route (`generate.cjs`) flattened all steps into a single array without explicit synchronization gates between different entity types.
**Result**: **FIXED**. Refactored `generate.cjs` to group Product and Account steps into nested parallel subflows, and updated the orchestrator to support recursive synchronization gates. This ensures Orders only start after both parent flows are fully terminal.

### [x] Fix Missing Attachments in Mock Data (PRIORITY 1)

**Issue**: Images and PDFs are not created in Demo Mode.
**Analysis**: Regression introduced in `ProductGenerator.cjs` where pre-filtering was added to step handlers, bypassing `MediaGenerator`'s internal fallback and ratio logic.
**Result**: **FIXED**. Removed pre-filtering from `ProductGenerator.cjs`, allowing `MediaGenerator` to handle ratios and fallbacks as it did previously.

### [x] Robust Inventory & Pricing Verification (PRIORITY 2)

**Issue**: Price entries and inventory records are reported as missing despite successful batches.
**Analysis**: Race conditions between batch callbacks and subsequent retrieval steps.
**Result**: **FIXED**. Implemented `_verifyPricing` and `_verifyInventory` polling loops in `ProductGenerator.cjs`. These are triggered by `BatchCallbackService` after successful batch completion to ensure data is visible to Liferay's indexing layer before the workflow proceeds.

---

## 52. Workflow Failures & Schema Adherence (Mar 2)

### [x] Fix GraphQL Validation Error in SKU Resolution (PRIORITY 1)

**Issue**: The 'resolve-sku-ids' step fails with a critical GraphQL validation error.
**Analysis**: The `getSkusByERC` method in `graphql.cjs` was previously incorrectly using the `skus` query with `externalReferenceCode`. This has been fixed to use `skuByExternalReferenceCode`. Additionally, the extraction logic in `ProductGenerator.cjs` was updated to avoid using the product's ERC as a fallback for SKUs, preventing 404s during resolution.
**Result**: **FIXED**.

### [x] Align Mock Account Data with Schema (PRIORITY 1)

**Issue**: Mock account generation fails schema validation in Demo Mode.
**Analysis**: The `account.json` schema requires the `accountContactInformation` property (including emailAddresses), but `MockDataGenerator.generateAccountData` does not provide it.
**Steps**:

1. Update `MockDataGenerator.cjs` to include a valid `accountContactInformation` block for all generated accounts.

### [x] Investigate Price List Retrieval Failure (HTTP Error)

**Analysis**: Investigation revealed two critical issues in `LiferayService`:

1.  **Duplicate Method Definitions**: `LiferayService` (in `index.cjs`) had two definitions for `getPriceLists`. The first used a robust GraphQL-based implementation to bypass OData limitations, but the second (at the end of the file) was a simple passthrough to the REST SDK. In JavaScript, the last definition wins, so the system was incorrectly using the fragile REST implementation.
2.  **REST Parameter Mismatch**: The REST implementation of `getPriceLists` incorrectly appended `catalogId` as a raw query parameter instead of part of an OData filter. This likely triggered 400 errors from Liferay's Pricing API, which only supports standard pagination and OData parameters.
    **Result**: **FIXED**. Removed duplicate REST-based passthrough from `index.cjs` to ensure the robust GraphQL implementation is always used.

### [x] Resolve Session Check Race Condition

**Issue**: Logs show frequent "Session already being processed, marked as dirty" warnings.
**Analysis**: The previous logic used non-atomic in-memory Sets, allowing concurrent callbacks to bypass checks and execute `executeNextStep` simultaneously.
**Result**: **FIXED**. Implemented a session-scoped promise chain (`sessionLocks` Map) in `BatchCallbackService` to ensure atomic, sequential execution of advancement logic per session.

---

## 53. Log Analysis & Workflow Stability (Mar 13)

### [x] Fix Warehouse Mock Data Schema Mismatch (PRIORITY 1)

**Issue**: MockDataGenerator.generateWarehouseData produces objects that fail validation against warehouse.json.
**Result**: **FIXED**.

### [x] Fix Account Mock Data Schema Mismatch (PRIORITY 1)

**Issue**: MockDataGenerator.generateAccountData fails schema validation in Demo Mode.
**Result**: **FIXED**.

### [x] Fix "undefined" Prefix in Error ERCs

**Issue**: Error reference codes in logs show as undefined-1773396002096-c347cce7.
**Result**: **FIXED**.

### [x] Prevent Workflow Advancement Stalls and Handle Sync Step Failures

**Issue**: The workflow was failing with "no current step found" or stalling after sync steps.
**Root Cause**:

1. `BaseGenerator.executeNextStep` was calling `executeStep` before persisting the updated `currentSteps` to the database, causing handlers to see an empty list.
2. `DeleteCoordinatorService.executeStep` had a redundant trigger logic that conflicted with the base class.
   **Result**: **FIXED**. Refactored `BaseGenerator` to persist state before execution and removed redundant overrides in `DeleteCoordinatorService`.

### [x] Improve Session Failure Propagation in Orchestrator

**Issue**: Critical errors during step execution are logged but not always reflected in the session status.
**Root Cause**: `BatchCallbackService._checkSessionCompletion` catches exceptions from `generator.executeNextStep` but does not consistently call `persistence.tryFailSession` to update the database state.
**Result**: **FIXED**. Updated `BatchCallbackService._checkSessionCompletion` to explicitly fail the session and notify the UI via WebSocket.

---

## 54. Realistic Mock Data & Schema Alignment (Mar 13 - Round 2)

### [x] Restore Realistic Mock Data Structure (PRIORITY 1)

**Issue**: The current mock data was overly simplified.
**Result**: **FIXED**. Re-introduced varied content templates and comprehensive dependency resolution (mock IDs) for products, accounts, and orders.

### [x] Fix Product Mock Data Schema Validation Errors

**Issue**: The logs report multiple schema validation failures for products in Demo Mode.
**Result**: **FIXED**. Updated `MockDataGenerator.generateProductData` to precisely match `product.json` (localization, flat variant options, baseSku, skus array with pricing/cost).

### [x] Fix Order Mock Data Null Account ID

**Issue**: Orders were missing valid account and product associations.
**Result**: **FIXED**. Implemented fallback pools and mock ID resolution in `generateOrderData`.

---

## 61. Structural Hardening: Payload Hygiene & WebSocket Stability (Mar 13 - Round 9)

### [x] Deep-Clean Forbidden Numeric IDs

**Result**: **FIXED**. Implemented a recursive `deepClean` helper in `BaseGenerator.cjs` and updated `ProductGenerator` and `AccountGenerator` to use it before batch submission. This removes any `id`, `productId`, `accountId`, or `skuId` properties, ensuring Liferay Headless Admin APIs accept the records.

### [x] Explicit Field Preservation (Product Details)

**Result**: **FIXED**. Audited `_cleanProductForLiferay` to ensure that commerce-rich fields like `productSpecifications`, `productOptions`, and `shortDescription` are explicitly preserved and mapped, preventing 'empty shell' products.

### [x] Harden WebSocket Targeting (Session-First)

**Result**: **FIXED**.

1. Refactored `WebSocketService.resolveTargets` to use `sessionId` as the primary lookup key.
2. Updated `deliver()` to ensure `sessionId` is correctly propagated through retries.
3. This ensures Liferay callbacks still correctly target the originating browser session even if proxy headers strip the `correlationId`.

### [x] Validate Batch Processing Success (Zero-Item Detection)

**Result**: **FIXED**. Refactored `BatchCallbackService` to treat batches with 0 processed items as `FAILED` even if Liferay reports `COMPLETED`, ensuring the workflow doesn't 'speed-run' over failures.

---

## 64. Finalize Catalog Context & WebSocket Mapping (Mar 13 - Round 12)

### [x] Add Required Catalog Fields (Tax & Status)

**Result**: **FIXED**. Updated `ProductGenerator._runProductCreationStep` to explicitly set `taxCategory: 'Standard'` and `productStatus: 0` (Published) for every product. This ensures Liferay doesn't reject records due to missing environment-specific defaults.

### [x] Simplified Initial SKU Payload

**Result**: **FIXED**. Refactored the initial product creation batch to only include `sku`, `published`, and `purchasable`. Price and inventory mappings are now moved to subsequent dedicated steps, preventing validation loops during the initial entity establishment.

### [x] Harden Frontend Progress reception (Session-First)

**Result**: **FIXED**. Updated `useRealtimeWebSocket.js` to use `sessionId` as the primary identifier for state updates, ignoring the often-missing `correlationId`. This ensures progress bars update correctly based on Liferay callbacks.

### [x] Verbose Failure Logging (Schema Mapping)

**Result**: **FIXED**. Updated `BatchCallbackService` to log the full raw JSON content of the first failed item when Liferay returns an 'Unknown error', facilitating manual schema comparison and debugging.

---

## 65. Batch Logic Hardening & Reliability

### [x] Orphaned Callback Backoff (PRIORITY 1)

**Issue**: Extremely fast callbacks may arrive before the initial submission persistence is complete.
**Result**: **FIXED**. Updated `processCallbackInternal` to identify missing records and throw a retryable error message for the queue.

### [x] Strict Batch Error Detection (PRIORITY 1)

**Issue**: Liferay may report 'COMPLETED' even if items failed.
**Result**: **FIXED**. Enhanced `BatchCallbackService` to check `errorCount` and treat any failure as terminal `FAILED` status.

### [x] Persistence Contention Retry (PRIORITY 2)

**Issue**: Concurrent `FileSync` writes might encounter file lock issues.
**Result**: **FIXED**. Implemented a `_write()` helper in `PersistenceService` with a 5-attempt retry loop for transient FS errors.

### [x] Inter-Service Settling Delay (PRIORITY 2)

**Issue**: Search indexing lag between different Liferay services (e.g. Catalog -> Pricing).
**Result**: **FIXED**. Introduced a 2-second settling delay in `BaseGenerator.executeNextStep` when crossing service boundaries.

### [x] Frontend Reconnection Sync (PRIORITY 3)

**Issue**: WebSocket reconnection resets progress bars to zero.
**Result**: **FIXED**. Implemented `WORKFLOW_STATUS` endpoint and updated `useRealtimeWebSocket` to hydrate progress state upon reconnection.

---

## 69. Dependabot & CI Hardening (May 12)

### [x] Resolve Dependabot Alerts & PRs

**Issue**: Multiple Dependabot PRs were failing due to stricter linting rules in newer ESLint/Vite versions.
**Result**: **FIXED**. Merged all 3 Dependabot PRs (#46, #47, #48). Fixed linting errors (`preserve-caught-error`, `no-useless-assignment`, and unused imports) across all workspaces to restore CI green status.

### [x] CI Compatibility Hardening

**Issue**: ESLint plugin-react failed to detect React version in CI environments with newer ESLint.
**Result**: **FIXED**. Hardcoded React version `19.0` in both configuration and frontend ESLint configs to ensure stable, environment-agnostic linting.

### [x] Cleanup Failed CI Runs

**Analysis**: Stale failed runs from Dependabot dynamic updates and troubleshooting were cluttering the Actions tab.
**Result**: **CLEANED**. Deleted all failed GitHub Action runs using the `gh` CLI.

### [x] Forensic UI Enhancements

**Analysis**: Terminal failures were difficult to correlate without seeing the underlying diagnostic IDs in the frontend.
**Result**: **FIXED**. Updated the Session Detail view to display `errorReferenceCode` and `correlationId`. Added persistence support to capture and propagate these IDs throughout the workflow lifecycle.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
