# Liferay DXP Bug Report: GraphQL Collection Queries Fail with "Collection Query Not Allowed" or Filtering Limits

LPD-95081 - https://liferay.atlassian.net/browse/LPD-95081

## Component

- **Headless API / GraphQL Engine**
- **Security & Permissions / Scoped Querying**

## Environment

- **Liferay Product Version**: Liferay DXP `2026.q1.7-lts`.

## Summary

When querying collections of certain Commerce entities (such as Specifications, Option Categories, or Custom Fields) via the GraphQL endpoint (`/o/graphql`), the API returns error responses indicating that collection querying is not allowed, or fails when specific query parameters/filters are applied. This occurs even when the corresponding REST list endpoints (`GET`) resolve successfully under the same credentials.

## Description

Liferay's JAX-RS (Vulcan) framework exposes list endpoints for standard commerce entities. While standard REST clients can fetch lists of these resources using endpoints like `/o/headless-commerce-admin-catalog/v1.0/optionCategories`, querying the same collection under the `/o/graphql` endpoint fails with a validation or permission error (e.g. `"Collection query not allowed"`).

This restricts developers from using GraphQL as a unified query language for all Commerce entity schemas and forces split-method querying (using REST for lists and GraphQL for details).

## Steps to Reproduce

1. Log in as a portal administrator.
2. Attempt to run a GraphQL collection query for option categories or specifications:

   ```graphql
   query {
     optionCategories {
       items {
         id
         key
         title
       }
     }
   }
   ```

3. Observe the error response returned by Liferay:

   ```json
   {
     "errors": [
       {
         "message": "Collection query not allowed",
         "locations": [ ... ],
         "path": [ "optionCategories" ]
       }
     ]
   }
   ```

## Expected Results

Any entity that supports list fetching via the REST API should support collection querying via the GraphQL API under identical user credentials and permissions.

## Workaround

Fetch the entire collection using the REST endpoint and perform the necessary lookup/filtering in memory on the client side:
`GET /o/headless-commerce-admin-catalog/v1.0/optionCategories?pageSize=250`
