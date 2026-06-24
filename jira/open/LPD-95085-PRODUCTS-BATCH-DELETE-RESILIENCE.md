# Liferay DXP JIRA Bug / Improvement: Headless Commerce Catalog Product Batch Delete Fails on Missing Items (404)

LPD-95085 - https://liferay.atlassian.net/browse/LPD-95085

## Component

- **Headless Commerce / Headless API / Catalog**
- **Vulcan Batch Engine**

## Environment

- **Liferay Product Version**: Liferay DXP `2026.q1.7-lts` (and all earlier versions featuring the Headless Commerce Catalog APIs).
- **API Endpoint**: `DELETE /o/headless-commerce-admin-catalog/v1.0/products/batch`

## Summary

Invoking the native batch deletion for products via the Vulcan Batch Engine fails the entire background task if any of the specified products do not exist (HTTP `404 Not Found`). Instead of gracefully skipping missing records (which is the standard, expected behavior for cleanups and sync loops), the batch engine crashes the task, leaving the remaining items unprocessed. This makes the native batch delete endpoint fragile and unusable in asynchronous, decoupled environments where search index lag (e.g., in Elasticsearch) or concurrent deletion runs can lead to temporary mismatches.

## Description & Technical Analysis

Liferay's Vulcan Batch Engine handles batch deletes by processing a payload of entity identifiers (such as product internal IDs or external reference codes).

Inside the delete task item delegate (class: `com.liferay.headless.commerce.admin.catalog.internal.resource.v1_0.ProductResourceImpl`), if a product ID in the batch payload does not exist, the resource method throws a JAX-RS `javax.ws.rs.NotFoundException`.

Because the Batch Engine task wrapper does not soft-catch or ignore `NotFoundException` errors during item committing, the entire task execution halts and is marked as `FAILED`.

In high-concurrency environments or search-indexed catalogs (where Elasticsearch re-indexing lag can delay the sync between the database and the search index), an API caller might query products that exist in the index, but by the time the delete batch command is processed, one or more products might have already been removed or are temporarily unresolvable. This forces developers to bypass the native batch deletion endpoint and fall back to sequential, slow, individual `DELETE` HTTP calls.

## Steps to Reproduce

### 1. Ensure you have two products in DXP

Suppose they have IDs `40101` and `40102`.

### 2. Issue a batch delete call where one product ID does not exist

Pass one valid ID and one dummy/non-existent ID (e.g. `99999`):

```bash
curl -X 'DELETE' \
  'https://localhost:8080/o/headless-commerce-admin-catalog/v1.0/products/batch' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -u 'test@liferay.com:test' \
  -d '[
    {
      "productId": 40101
    },
    {
      "productId": 99999
    }
  ]'
```

### 3. Observe the Batch Engine Task Status

Check the status of the resulting delete task.

## Expected Results

The batch engine deletes product `40101`, gracefully ignores/skips the non-existent product `99999` (logging a warning or informational debug message), and completes the task successfully.

## Actual Results / Logs

The background batch task fails completely:

- Product `40101` may or may not be deleted depending on database commit boundaries.
- The task status is marked as `FAILED`.
- Server logs output a `NotFoundException` or vulkan mapping error.

## Workaround & Resolution

To ensure a resilient cleanup, integrations must switch to simulated batching, where they split the list of IDs into small chunks and delete them sequentially using individual `DELETE /products/{productId}` requests, trapping and ignoring `404` errors at the client level.

### Proposed Fix

Update the batch delete delegate for products (and other commerce entities) to catch `NotFoundException` (or general 404 status codes) at the item processing level, allowing them to be soft-resolved/ignored so that the rest of the batch task can complete successfully.
