---
name: platform-findings
description: Activate this skill when troubleshooting API errors, handling database seeding, or interfacing with headless commerce endpoint operations.
---

# Liferay Platform & API Behavioral Findings

To handle Liferay Headless API constraints and environment-specific behaviors correctly, review the following analysis and platform findings:

## 1. Known Operational States

- **Demo Mode**: Uses deterministic ERCs for addresses. Repeated runs will trigger "Duplicate address" errors unless the database is cleared.
- **Liferay Password**: Default local development password is set to `L1feray$`.
- **Node Version**: v24.0.0+ is the current target; ensure native modules are rebuilt if switching environments.

## 2. Deletion Discovery & Sequencing

1. **Sequencing Dependency**: `deleteOrders` must precede `deleteAccounts` due to Liferay referential integrity.
2. **Discovery Flaw**: `LiferayService.getAccounts` relies on querying existing orders when a `channelId` is provided. If orders are already deleted, discovery returns zero results.
3. **Corrective Pattern (Comprehensive Manifest)**: Deletion discovery MUST perform a complete sweep of all entities (**Orders, Products, Accounts, Warehouses, Price Lists, Promotions, Specifications, and Options**) _before_ any deletion begins. This captures volatile IDs and relationships while links are still valid.
4. **Property Resilience**: Discovery logic must check both `erc` and `externalReferenceCode` to account for variations in Liferay's Headless DTO property naming.

## 3. Product & SKU Constraints

- **Product Type Constraint**: The Liferay Headless Commerce API requires the `productType` field to be `simple` for all products during initial creation. All generator logic, AI prompts, and schemas must strictly use `productType: 'simple'`.
- **SKU Property Constraints**: The `Sku` DTO does not recognize an `active` property. Including it will cause import failure.
- **SKU Option Activation**: A SKU linked to a product with SKU-contributing options is active only if it has an explicit `skuOption` entry for **every** contributing option.

## 4. Batch Engine Verb Support

- **Constraint**: Not all Liferay Batch Engine endpoints support the HTTP `DELETE` verb.
- **Simulated Deletion Fallback**: Older commerce entities (Warehouses, Orders, Accounts, Specs, Options) often fail or ignore global batch 'DELETE' strategies. For these types, use **Simulated Batch Deletion** (sequential individual `DELETE` requests) to ensure 100% cleanup reliability and accurate progress reporting.

## 5. Resilient Order Generation (Indexing Workaround)

- **Search Index Lag**: Immediately after creating products and SKUs, Liferay's search index may not be updated. Queries like `getProductsWithSkus` may return 0 SKUs, causing order generation to crash with "No purchasable SKUs found."
- **Session Context Fallback**: The generator uses a **Session Context Fallback** where, if the API returns incomplete data, the system automatically injects resolved SKU IDs directly from the persistent session memory (`productDataList`).

## 6. Security & History Hygiene

- **Purge Policy**: Sensitive files (`workflows.db`, `*.log`) must be purged from Git history using `git-filter-repo` if accidentally committed.
- **Resolution Lockdown**: Always use `resolutions` in root `package.json` to override nested vulnerabilities (e.g., `uuid`, `axios`, `braces`).
- **CI Cleanup**: Delete any failed GitHub Action jobs (e.g., via `gh run delete`) to maintain a clean workflow history.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-19_ | _Last Reviewed: 2026-07-19_
