# Liferay DXP Bug Report: Scoped WarehouseItems Batch Endpoint Fails on Parent Scoping / ERC Query Parameter Collision

LPD-95086 - https://liferay.atlassian.net/browse/LPD-95086

## Component

- **Headless Commerce / Headless Inventory**
- **Vulcan Batch Engine**

## Environment

- **Liferay Product Version**: Liferay DXP `2026.q1.7-lts`.

## Summary

Submitting warehouse items in bulk to the scoped batch import endpoint `/o/headless-commerce-admin-inventory/v1.0/warehouses/{warehouseId}/warehouseItems/batch` fails or creates database conflicts. This is caused by the Vulcan Batch Engine requiring an `externalReferenceCode` query parameter to track the import task itself, which collides with either the `Warehouse` parent entity's ERC or the `WarehouseItem` entities being imported.

## Description

When submitting standard commerce batch payloads:

1. The endpoint `/o/headless-commerce-admin-inventory/v1.0/warehouses/{warehouseId}/warehouseItems/batch` expects the parent context (the Warehouse) to be resolved.
2. The Vulcan Batch Engine requires an `externalReferenceCode` query parameter in the batch request URL to register the `ImportTask` identifier.
3. This creates a namespace collision in parameter parsing inside Liferay’s background batch task executor: Liferay gets confused between the task ERC, the parent Warehouse ERC, and the nested items' ERCs.
4. The background task fails with database key collisions (e.g. attempting to assign the task's ERC as the warehouse's ERC) or fails to resolve the parent context.

## Steps to Reproduce

1. Establish a Warehouse in Liferay with external reference code `TEST-WH-001`.
2. Construct a batch payload of warehouse items:

   ```json
   [
     {
       "sku": "SKU-TEST-001",
       "inventoryLevel": 150
     }
   ]
   ```

3. Issue a POST request to the scoped batch endpoint:
   `POST http://localhost:8080/o/headless-commerce-admin-inventory/v1.0/warehouses/TEST-WH-001/warehouseItems/batch?createStrategy=UPSERT`
4. Inspect the background task created under Control Panel -> Job Scheduler (or Vulcan Import Tasks).
5. Observe that the background task fails with validation errors or duplicate key exceptions.

## Expected Results

The batch engine imports the items under the target warehouse without database conflicts or parameter collisions.

## Workaround

Avoid using the scoped batch endpoint. Instead, perform simulated batch creation by issuing parallel single `POST` requests directly to the scoped warehouse items endpoint:
`POST /o/headless-commerce-admin-inventory/v1.0/warehouses/{warehouseId}/warehouseItems`
