# Parent Issue: Support Liferay PIM (ePIM) and dynamic Catalog Seeding in AICA

**Title**: `[PIM Refactor] Support standalone Liferay PIM and dynamic Catalog/PIM Seeding via SDK Adapters`  
**Type**: Feature / Refactoring  
**Labels**: `epic`, `enhancement`

---

## Context & Objectives

Liferay is introducing a standalone **Liferay PIM** (expected in Q3/Q4). As clarified by product leadership, this PIM will **not** replace the existing Liferay Commerce product management system. Instead:

1.  **Coexistence**: Liferay Commerce's product catalog APIs (`/o/headless-commerce-admin-catalog/v1.0`) will continue to exist as-is to power shopping, inventory, and checkout.
2.  **PIM Connector**: Liferay PIM will manage product trees and SKUs independently, and use a PIM-to-Commerce connector to push/sync data into Commerce products.

This means AICA has two execution modes depending on the target DXP environment setup:

- **Direct-to-Commerce (Legacy/Standard Mode)**: Seeds B2B datasets directly into Commerce APIs (for classic setups).
- **PIM-centric (PIM Mode)**: Seeds B2B datasets into the new Liferay PIM APIs, showing the full enterprise flow where PIM ingests AI data and syncs it to Commerce.

To support both modes dynamically and ensure backward compatibility, we will refactor the SDK's catalog layer using the **Adapter Pattern**.

---

## High-Level Implementation Strategy

1.  **Introduce a Catalog Adapter Layer**: Define a standard `LiferayCatalogAdapter` interface in the SDK to isolate catalog write/read requests.
2.  **Move Static Paths to Route Profiles**: Group paths under version profiles (`legacy` vs. `pim`).
3.  **Implement Runtime Auto-Discovery**: Detect platform capabilities by inspecting registered API endpoints.
4.  **Decouple Data Generators**: Update the generation steps in [productGenerator.cjs](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/client-extensions/ai-commerce-accelerator-microservice/generators/productGenerator.cjs) and teardown logic in [deleteProducts.cjs](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/client-extensions/ai-commerce-accelerator-microservice/services/batch/batch-steps/deleteProducts.cjs) to talk exclusively to the adapter interface.

---

## Sub-Issues Breakdown

- **Sub-Issue #1**: [Refactor Path Resolution into Configuration Route Profiles](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/issues/PIM_REFACTOR_SUB_ISSUES.md#sub-issue-1-refactor-path-resolution-into-configuration-route-profiles) (Preparatory)
- **Sub-Issue #2**: [Define LiferayCatalogAdapter Interface and Legacy Implementation](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/issues/PIM_REFACTOR_SUB_ISSUES.md#sub-issue-2-define-liferaycatalogadapter-interface-and-legacy-implementation) (Preparatory)
- **Sub-Issue #3**: [Implement Auto-Discovery Capability Detection Factory](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/issues/PIM_REFACTOR_SUB_ISSUES.md#sub-issue-3-implement-auto-discovery-capability-detection-factory) (Preparatory)
- **Sub-Issue #4**: [Decouple productGenerator and deleteProducts from direct REST endpoints](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/issues/PIM_REFACTOR_SUB_ISSUES.md#sub-issue-4-decouple-productgenerator-and-deleteproducts-from-direct-rest-endpoints) (Preparatory)
- **Sub-Issue #5**: [Develop PimSkuFirstAdapter (upon OpenAPI specification release)](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/issues/PIM_REFACTOR_SUB_ISSUES.md#sub-issue-5-develop-pimskufirstadapter-upon-openapi-specification-release) (Implementation Phase)
- **Sub-Issue #6**: [Update AI Generation Prompts & Schemas for Tree Formats](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/issues/PIM_REFACTOR_SUB_ISSUES.md#sub-issue-6-update-ai-generation-prompts-&-schemas-for-tree-formats) (Implementation Phase)
- **Sub-Issue #7**: [End-to-End Test and Validation Suite](file:///Volumes/SanDisk/repos/liferay-ai-commerce-accelerator/docs/issues/PIM_REFACTOR_SUB_ISSUES.md#sub-issue-7-end-to-end-test-and-validation-suite) (Verification Phase)

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
