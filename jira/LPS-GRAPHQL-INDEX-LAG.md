# Liferay DXP Bug Report: GraphQL Queries Fail to Return Newly Created Entities Due to Search Index Lag

LPD-95082 - https://liferay.atlassian.net/browse/LPD-95082

## Component

- **Headless API / GraphQL Engine**
- **Search / Elasticsearch Integration**

## Environment

- **Liferay Product Version**: Liferay DXP `2026.q1.7-lts` (and general versions utilizing asynchronous search index updates).

## Summary

GraphQL queries targeting newly created Commerce entities (such as Products and SKUs) fail to retrieve the entities immediately after successful creation. This is due to Liferay’s GraphQL layer querying the search index (Elasticsearch) instead of the database. Because indexation happens asynchronously, there is a race condition where subsequent automated API calls receive empty or stale results.

## Description

In automated integration scenarios (like accelerators and headless setups), a common pattern is to create an entity via a REST endpoint and immediately query or link it in the next step.

When creating entities via the REST APIs, they are persisted synchronously to the database. However, the search index update is dispatched to a background queue.

Liferay’s `/o/graphql` API resolves queries by executing search index queries rather than querying the database directly. If a GraphQL query is run immediately after creation, the search index has not yet finished indexing the new document, resulting in a silent query failure (empty returns).

## Steps to Reproduce

1. Create a new Commerce product via REST API:

   ```bash
   curl -X 'POST' \
     'https://localhost:8080/o/headless-commerce-admin-catalog/v1.0/products' \
     -H 'Content-Type: application/json' \
     -u 'test@liferay.com:test' \
     -d '{
       "name": { "en_US": "Temporary API Test Product" },
       "externalReferenceCode": "API-TEST-INDEX-LAG-001",
       "productType": "simple"
     }'
   ```

2. Immediately query the product using the GraphQL endpoint (`/o/graphql`) in the subsequent request:

   ```graphql
   query {
     products(filter: "externalReferenceCode eq 'API-TEST-INDEX-LAG-001'") {
       items {
         id
         name
       }
     }
   }
   ```

3. Observe that the result returns empty (`"items": []`).
4. Wait 2–5 seconds (or trigger a manual reindex via Control Panel -> Search -> Reindex), rerun the GraphQL query, and observe that the product is now successfully returned.

## Expected Results

GraphQL queries (especially filters matching specific, unique fields like `externalReferenceCode`) should resolve correctly immediately after database persistence, either via a database-fallback query mechanism or by exposing synchronous index-refresh options in headless workflows.

## Workaround / Mitigation

Integrators must bypass GraphQL and use database-backed REST endpoints for immediate downstream operations (such as fetching or linking newly created items):
`GET /o/headless-commerce-admin-catalog/v1.0/products/by-externalReferenceCode/API-TEST-INDEX-LAG-001`

REST calls scoped by `externalReferenceCode` bypass search index indexation queues and look up the entity directly in the database.
