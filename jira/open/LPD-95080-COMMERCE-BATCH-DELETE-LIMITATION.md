# Liferay DXP JIRA Feature Request / Bug: Lack of Unified REST Batch Delete Support for Core Commerce and Portal Entities

LPD-95080 - https://liferay.atlassian.net/browse/LPD-95080

## Component

- **Headless Commerce / Headless API**
- **Headless Admin User / Accounts**
- **Vulcan Batch Engine**

## Environment

- **Liferay Product Version**: Liferay DXP `2026.q1.7-lts` (and general versions utilizing Vulcan/Batch Engine integrations).

## Summary

The Headless REST APIs for several core Commerce and Portal entities (such as Option Categories, Options, Specifications, Price Lists, Warehouses, and Accounts) do not expose native batch deletion endpoints or fail to execute bulk deletions via their respective batch endpoints. This forces client extensions and external integration systems to implement "simulated batching" (looping over individual IDs to fire individual HTTP `DELETE` requests). For large datasets, this sequential individual deletion model causes severe network overhead, database transaction lock contention, and drastically slows down teardown/cleanup operations.

## Description & Technical Analysis

Standard vulcan-based batch endpoints (e.g., for Products) allow importing and updating items in bulk. However, the JAX-RS (Vulcan) framework does not consistently support or implement the HTTP `DELETE` verb across all batch resources.

For example, while catalog products support batch operations, attempting to use batch delete options on endpoints like:

- `/o/headless-commerce-admin-catalog/v1.0/optionCategories/batch`
- `/o/headless-commerce-admin-catalog/v1.0/options/batch`
- `/o/headless-commerce-admin-catalog/v1.0/specifications/batch`
- `/o/headless-commerce-admin-pricing/v2.0/price-lists/batch`
- `/o/headless-admin-user/v1.0/accounts/batch`

results in HTTP `405 Method Not Allowed`, or the Batch Engine task task-executor ignores the operation.

This lack of parity between creation/update batch capabilities and deletion batch capabilities forces integration frameworks to fall back to simulated batching.

### Impact of Simulated Batching

1. **Network Overhead**: Firing hundreds of individual HTTP `DELETE` requests creates high latency.
2. **Database Performance**: Each individual request is wrapped in its own database transaction, creating significant overhead compared to a single bulk transaction.
3. **Locking Issues**: High-concurrency individual deletes can lead to database deadlock errors under load.

## Steps to Reproduce

### 1. Attempt a Batch Delete on Option Categories

Construct a payload containing IDs or ERCs of Option Categories you wish to delete, and issue a HTTP `DELETE` request to the batch endpoint:

```bash
curl -X 'DELETE' \
  'https://localhost:8080/o/headless-commerce-admin-catalog/v1.0/optionCategories/batch' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -u 'test@liferay.com:test' \
  -d '[
    "OC-TEST-001",
    "OC-TEST-002"
  ]'
```

### 2. Observe the API Response

Observe that the server rejects the request:

```json
{
  "status": 405,
  "title": "Method Not Allowed",
  "detail": "The HTTP method DELETE is not allowed for this URI."
}
```

## Expected Results

Every JAX-RS / Vulcan Batch endpoint that supports bulk entity creation/updates should also support bulk deletion (via HTTP `DELETE` with a JSON list of IDs/ERCs).

## Workaround

Client integrations must retrieve all entities first, extract their individual IDs, and perform simulated batching by sending individual `DELETE` requests (sequentially or in throttled parallel chunks):
`DELETE /o/headless-commerce-admin-catalog/v1.0/optionCategories/{optionCategoryId}`

This has been implemented in the Liferay Commerce AI Accelerator SDK to work around this limitation.

## Proposed Fix

Introduce native batch/bulk delete capabilities across all JAX-RS Headless resources using the Vulcan Batch Engine, matching the existing batch import architecture.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_
