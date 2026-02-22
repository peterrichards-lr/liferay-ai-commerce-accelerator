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

### [ ] Persistent Warehouse Resolution Failure (STALE_INDEX)
**Analysis**: Despite a 12-attempt retry loop, `resolve-warehouse-ids` is still timing out with `STALE_INDEX`.
- **Root Cause**: A structural mismatch in the data flow. `WarehouseGenerator.createWarehouses` returns a batch reference (containing the **Batch ERC**) instead of individual warehouse data when using batch mode. `ProductGenerator` then incorrectly uses this batch ERC to attempt warehouse-level ID resolution. Since the batch ERC never matches an individual warehouse, Liferay returns `null`, triggering the `STALE_INDEX` retry logic until timeout.
- **Affected Code**: `WarehouseGenerator.cjs` (return value of `createWarehouses`) and `productGenerator.cjs` (`_runResolveWarehouseIdsStep`).
**Proposed Steps**:
1. Refactor `WarehouseGenerator.createWarehouses` to return the `normalizedWarehouseDataList` (which contains individual ERCs) even in batch mode.
2. Update `ProductGenerator._runWarehouseGenerationStep` to correctly preserve these individual ERCs in the session context.
3. (Optional) Enhance `liferay.getWarehousesByERC` logs to differentiate between batch ERCs and individual entity ERCs.
