# LPD-XXXXX: Warehouse Item Creation Indexing Lag

## Context

When dynamically creating catalog entities in Liferay Commerce (such as SKUs and Warehouses), Liferay utilizes Vulcan Batch Engine and asynchronous OSGi services.

## Issue

Immediately assigning a newly created SKU to a Warehouse via the single POST endpoint (`/o/headless-commerce-admin-inventory/v1.0/warehouses/{warehouseId}/warehouseItems`) occasionally fails with a `400 Bad Request` and the error message: `The service parameter was not provided by this object`.

This typically happens when Liferay's Elasticsearch indexing mechanism lags behind the API creation, causing the internal framework to fail to resolve the service parameter context necessary to link the SKU and Warehouse effectively.

## Workaround

To mitigate this inside automated tooling or data generators, the POST operation should be wrapped in a polling retry loop. Catching the specific exception string (`The service parameter was not provided by this object`) and retrying after a brief delay (e.g., 2000ms) allows the internal indices to catch up, bypassing the 400 error.

```javascript
let retryCount = 0;
let success = false;
while (retryCount < 5 && !success) {
  try {
    // Attempt POST to /warehouseItems
    success = true;
  } catch (err) {
    const isServiceParamError = err.message?.includes(
      'The service parameter was not provided by this object'
    );
    if (isServiceParamError) {
      retryCount++;
      await delay(2000); // Wait for indexing
    } else {
      throw err;
    }
  }
}
```

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_
