# Liferay DXP JIRA Bug Report: Headless Commerce Pricing v2.0 Scoped PriceEntry POST Fails via Vulcan Batch Engine

LPD-95083 - https://liferay.atlassian.net/browse/LPD-95083

## Component

- **Headless Commerce / Headless API**
- **Commerce Pricing / Pricing Engine**
- **Vulcan Batch Engine**

## Environment

- **Liferay Product Version**: Liferay DXP `2026.q1.7-lts` (and possibly earlier versions featuring Vulcan/Batch Engine integrations on Pricing v2.0).
- **API Version**: `headless-commerce-admin-pricing` version `v2.0`.

## Summary

Invoking a single resource HTTP `POST` to `/o/headless-commerce-admin-pricing/v2.0/price-lists/{priceListId}/price-entries` delegates internally to Liferay's Vulcan Batch Engine to perform the import asynchronously. However, the path parameter `{priceListId}` (representing the parent Price List scope) is not propagated into the Batch Engine task's metadata (`parameters: "{}"`). Consequently, the background task executor (`VulcanBatchEngineTaskItemDelegateAdaptor`) fails to find the required scoping context, crashing the import job with:
`jakarta.ws.rs.NotSupportedException: One of the following parameters must be specified: [externalReferenceCode]`.

## Description & Technical Analysis

Liferay's Headless Commerce Pricing v2.0 API maps the single creation of price entries to the controller endpoint `/o/headless-commerce-admin-pricing/v2.0/price-lists/{id}/price-entries` (operation `postPriceListIdPriceEntry`).

Internally, this synchronous-looking HTTP POST delegates the creation flow to the asynchronous Vulcan Batch Engine by creating a background task (class: `com.liferay.headless.commerce.admin.pricing.dto.v2_0.PriceEntry`).

During this transition:

1. The JAX-RS / Vulcan framework fails to pass the path parameter `{id}` from the request URL path to the Batch Engine task's `parameters` JSON map (resulting in `"parameters": "{}"`).
2. When the background job executor is scheduled on the pool (e.g., thread `default-132`), `BatchEngineImportTaskExecutorImpl` invokes the adaptor:
   `com.liferay.portal.vulcan.internal.batch.engine.VulcanBatchEngineTaskItemDelegateAdaptor.create(VulcanBatchEngineTaskItemDelegateAdaptor.java:73)`.
3. The adaptor maps the task back to the JAX-RS resource `com.liferay.headless.commerce.admin.pricing.internal.resource.v2_0.BasePriceEntryResourceImpl.create(...)`.
4. Since the parameters map is empty (`"{}"`), the adaptor has no parent ID. It tries to map the parent scope using the alternative `externalReferenceCode` path parameter (from the companion endpoint `/price-lists/by-externalReferenceCode/{externalReferenceCode}/price-entries`).
5. Because neither the path parameter `id` nor `externalReferenceCode` was propagated to the background task, the adaptor throws a JAX-RS `jakarta.ws.rs.NotSupportedException`.

This completely prevents standard client integrations from using the standard ID-scoped POST endpoint to add price entries.

## Steps to Reproduce

### 1. Identify/Create a Price List and SKU

Ensure you have a Price List and SKU in your Liferay Commerce instance. Let's assume:

- **Price List ID**: `34567`
- **SKU Code**: `TEST-SKU-001`
- **Price List ERC**: `AICA-PL-GENERAL`

### 2. Issue the Scoped Single POST Request

Submit a POST request to add a single price entry to that list:

```bash
curl -X 'POST' \
  'https://localhost:8080/o/headless-commerce-admin-pricing/v2.0/price-lists/34567/price-entries' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -u 'test@liferay.com:test' \
  -d '{
    "price": 99.99,
    "externalReferenceCode": "PE-TEST-001",
    "active": true,
    "skuExternalReferenceCode": "TEST-SKU-001"
  }'
```

### 3. Observe the Logs

Inspect the server logs. Although the HTTP response might return `202 Accepted` (or a successful status code indicating the batch task was created), check the server log output.

## Expected Results

The price entry is created and associated with the Price List `34567` (or whatever ID was passed in the URL).

## Actual Results / Logs

The Batch Engine job immediately crashes in the background thread with the following logs:

```text
aica | 2026-06-13 04:55:39.342 INFO  [default-132][BatchEngineImportTaskExecutorImpl:106] Started batch engine import task 3074
aica | 2026-06-13 04:55:39.455 ERROR [default-132][BatchEngineImportTaskExecutorImpl:174] Unable to update batch engine import task {"mvccVersion": 1, "uuid": "e89b4668-bf9d-2a9d-4a54-c2dfad69e423", "externalReferenceCode": "e89b4668-bf9d-2a9d-4a54-c2dfad69e423", "batchEngineImportTaskId": 3074, "companyId": 24709732577535, "userId": 20132, "createDate": "Sat Jun 13 04:55:39 GMT 2026", "modifiedDate": "Sat Jun 13 04:55:39 GMT 2026", "batchSize": 100, "callbackURL": "", "className": "com.liferay.headless.commerce.admin.pricing.dto.v2_0.PriceEntry", "contentType": "JSON", "endTime": "null", "errorMessage": "", "executeStatus": "STARTED", "fieldNameMapping": "null", "importStrategy": 2, "operation": "CREATE", "parameters": "{}", "processedItemsCount": 0, "startTime": "Sat Jun 13 04:55:39 GMT 2026", "taskItemDelegateName": "", "totalItemsCount": 1}
aica | jakarta.ws.rs.NotSupportedException: One of the following parameters must be specified: [externalReferenceCode]
aica |     at com.liferay.headless.commerce.admin.pricing.internal.resource.v2_0.BasePriceEntryResourceImpl.create(BasePriceEntryResourceImpl.java:553) ~[?:?]
aica |     at com.liferay.portal.vulcan.internal.batch.engine.VulcanBatchEngineTaskItemDelegateAdaptor.create(VulcanBatchEngineTaskItemDelegateAdaptor.java:73) ~[?:?]
aica |     at com.liferay.batch.engine.internal.BatchEngineImportTaskExecutorImpl._commitItems(BatchEngineImportTaskExecutorImpl.java:275) ~[?:?]
aica |     at com.liferay.batch.engine.internal.BatchEngineImportTaskExecutorImpl._importFile(BatchEngineImportTaskExecutorImpl.java:501) ~[?:?]
aica |     at com.liferay.batch.engine.internal.BatchEngineImportTaskExecutorImpl.lambda$execute$0(BatchEngineImportTaskExecutorImpl.java:164) ~[?:?]
aica |     at com.liferay.batch.engine.internal.BatchEngineTaskExecutorUtil.execute(BatchEngineTaskExecutorUtil.java:63) ~[?:?]
aica |     at com.liferay.batch.engine.internal.BatchEngineImportTaskExecutorImpl.execute(BatchEngineImportTaskExecutorImpl.java:162) ~[?:?]
aica |     at com.liferay.batch.engine.internal.BatchEngineImportTaskExecutorImpl.execute(BatchEngineImportTaskExecutorImpl.java:94) ~[?:?]
aica |     at com.liferay.headless.batch.engine.internal.resource.v1_0.ImportTaskResourceImpl.lambda$_importFile$2(ImportTaskResourceImpl.java:530) ~[?:?]
aica |     at java.util.concurrent.Executors$RunnableAdapter.call(Executors.java:572) ~[?:?]
aica |     at java.util.concurrent.FutureTask.run(FutureTask.java:317) ~[?:?]
aica |     at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1144) ~[?:?]
aica |     at java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:642) ~[?:?]
aica |     at java.lang.Thread.run(Thread.java:1583) [?:?]
```

## Workaround & Resolution

Integrators must bypass the ID-scoped single POST endpoint and use the ERC-scoped endpoint instead:
`POST /o/headless-commerce-admin-pricing/v2.0/price-lists/by-externalReferenceCode/{priceListExternalReferenceCode}/price-entries`

When executing against this path, the path parameter is `externalReferenceCode` (the ERC of the parent Price List). The JAX-RS Vulcan framework correctly parses and propagates this parameter to the Batch Engine's internal task parameters map, allowing the adaptor to resolve the parent scope successfully and import the entry.
