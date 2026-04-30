# Schema Audit Report: Generation vs. Liferay API

This report documents discrepancies between internal `generation-schemas` (AI/Mock output) and authoritative Liferay `api-schemas` (OpenAPI).

## 0. Authoritative Reference Bundles
We maintain "Reference Bundles" in `api-schemas/examples/` that document the exact mapping between REST and GraphQL for key entities. These serve as the "Ground Truth" for all mapping logic.

- `reference-channel.json`: Verified `HeadlessCommerceAdminChannel_v1_0` namespace.
- `reference-catalog.json`: Verified `HeadlessCommerceAdminCatalog_v1_0` namespace.
- `reference-option-categories.json`: Verified `OptionCategory` (Specification Group) mapping.
- `reference-option.json`: Noted case discrepancy in `fieldType` (REST: lowercase vs GQL: UPPERCASE).
- `reference-specification.json`: Verified mapping for attribute definitions and visual groupings.
- `reference-sku.json`: Confirmed that `SkuOption` requires numeric `optionId` and `optionValueId` for activation (ERCs not available in response).
- `reference-product.json`: Verified `optionExternalReferenceCode` support. **NOTE**: GraphQL returns `null` for nested collections (skus, specs) if the Search Index is not current. REST `nestedFields` is the only 100% reliable real-time discovery method.
- `reference-inventory.json`: Confirmed that inventory is 100% ID-free using `sku` (string) and `warehouseExternalReferenceCode`.
- `reference-order.json`: Verified total ERC-capability for Orders, Items, and Addresses.
- `reference-shipment.json`: Confirmed that Shipments link to Order Items and Warehouses via ERCs.

## 0.1 Naming and Brand Consistency
- Found that `fragments/collection.json` was misnamed as "AI Content Accelerator".
- Corrected all source references to strictly use **"AI Commerce Accelerator"**.
- Database artifacts (`lportal.script`) may still contain legacy names from previous runs; these should be disregarded in favor of the source code.

## 1. Product Schema (`product.json`)

### Product DTO (Batch Engine Creation)
*   **Contradiction**: `gemini.md` states `productType: 'simple'` is mandatory for creation. OpenAPI L3024 shows `productType` as a string without explicit enum in the DTO, but experience shows Liferay rejects 'variable' products in the initial batch.
*   **Missing Field**: `productStatus` (integer) is missing in `product.json` but required for consistency. Generator defaults to `0` (Published).
*   **Missing Field**: `taxCategory` is missing in `product.json`. Generator defaults to `'Standard'`.

### ProductOption DTO
*   **Name Mismatch**: `product.json` uses `name` (string). Liferay expects `name` (i18n object).
*   **Values Mismatch**: `product.json` uses `productOptionValues` (array of strings). Liferay expects `productOptionValues` (array of `ProductOptionValue` objects with `key` and `name` i18n).
*   **Key Mismatch**: `product.json` has `fieldType`, `name`, `skuContributor`. Liferay requires `key` as well.

### ProductSpecification DTO
*   **Field Mismatch**: `product.json` uses `value` (i18n). Liferay expects `label` (i18n).
*   **Field Mismatch**: `ProductGenerator.cjs` uses `title`. Liferay expects `label`.

---

## 2. Account Schema (`account.json`)

### Account DTO
*   **Clarified Mapping**: `account.json` includes `headOfficeAddress` as a top-level object. This must be mapped to `accountContactInformation.postalAddresses` (array) with `addressType: 'other'`.
*   **Separation of Concerns**: `postalAddresses` at the root of the `Account` DTO are reserved for Billing and Shipping addresses, which are created in separate workflow steps.
*   **Validation Guard**: `billingAddress` and `shippingAddress` in `account.json` must NOT be sent in the initial `Account` batch.

---

## 3. Order Schema (`order.json`)

*   **Audit Pending**: `headless-commerce-admin-order-v1.0-openapi.json` is missing from the codebase. 
*   **Observation**: Current implementation in `orderGenerator.cjs` seems to work, but lacks formal contract verification.

---

## 4. Pricing Schema (`pricing.json`)

### PriceList DTO (v2.0)
*   **Missing Fields**: `catalogId`, `currencyCode`, `type` are mandatory in Liferay but missing/implied in `pricing.json`.

### PriceEntry DTO (v2.0)
*   **ID vs ERC**: Liferay Pricing V2.0 strongly prefers `skuId` and `priceListId` (numeric). `pricing.json` provides `sku` (string code).
*   **Field Mismatch**: `pricing.json` uses `discount` (percentage). Liferay expects `promoPrice` (absolute value).

---

## 5. Warehouse Schema (`warehouse.json`)

*   **Fields Mismatch**: `warehouse.json` uses `addressCountry`, `addressLocality`, `addressRegion`. Liferay `Warehouse` DTO expects `countryISOCode`, `city`, `regionISOCode`.

---

## Conclusion & Action Plan

The discrepancies confirm why the system is "fragile". The generators are performing manual, sometimes incorrect, translations.

**Immediate Actions:**
1.  Update `ProductGenerator` to map `value` -> `label` for specifications.
2.  Update `ProductGenerator` to map `productOptionValues` (strings) to `ProductOptionValue` objects.
3.  Update `WarehouseGenerator` to map address fields to Liferay-specific names.
4.  Implement `ContractValidator` in `rest.cjs` to catch these at runtime.

## API Field Requirement Discrepancies

### Geographic Identifiers (Country/Region)

Through empirical testing and analysis of Liferay reference objects, we have identified inconsistent requirements for country and region fields across different Headless APIs:

| API Component | Entity | Country Field | Required Format | Region Field | Required Format |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `headless-admin-user` | `PostalAddress` | `addressCountry` | **Full Name** (e.g., "United States") | `addressRegion` | **Full Name** (e.g., "Texas") |
| `headless-commerce-admin-inventory` | `Warehouse` | `countryISOCode` | **ISO a2** (e.g., "US") | `regionISOCode` | **Region Code** (e.g., "NY") |

**Impact**: Using ISO codes for `PostalAddress` results in `javax.ws.rs.BadRequestException: Country not found`, even though those same codes are valid for `Warehouse` entities.

**Action**: Generators must be schema-aware and use the `LiferayPayloadStandardizer` (to be implemented) or specialized mapping logic to ensure the correct geographic identifiers are sent based on the target API.

### Title vs Name Inconsistency (Country/Region)

Liferay's `Country` and `Region` entities use the `name` field for internal, often hyphenated and lowercase, keys (e.g., "united-states"). However, the `PostalAddress` Headless API requires the user-friendly display name (e.g., "United States").

**Discovery**:
- `Country.name`: "united-states"
- `Country.title_i18n`: { "en_US": "United States" }
- `PostalAddress.addressCountry`: MUST BE "United States"

**Action**: We now fetch `title_i18n` via GraphQL and use a helper to extract the best display name for address fields.

### Specification Groups vs Option Categories

We discovered that in Liferay Commerce 1.0 Headless API, "Specification Groups" are physically managed via the `OptionCategory` DTO and endpoints. 

**Discovery**:
- `ProductSpecification` DTO uses `optionCategoryId` to group specifications.
- There is no separate `SpecificationCategory` endpoint; `optionCategories` is used instead.

**Action**: Implement `createSpecificationCategoryWithReuse` (mapping to `OptionCategory`) and link all generated specifications to a default "General" category to ensure they appear correctly in the UI.

### Unified Flow Data Dependencies

The combined generation flow (Products + Accounts + Orders) requires all data generation steps to be explicitly sequenced.

**Discovery**: `CREATE_WAREHOUSES` was being bypassed because the `GENERATE_WAREHOUSE_DATA` step was missing from the unified flow definition in `routes/generate.cjs`.

**Action**: Added `GENERATE_WAREHOUSE_DATA` and `ENSURE_SPECIFICATION_CATEGORIES` to the unified subflows to ensure all contexts are fully populated before physical creation starts.

### Geographic Format Discrepancies (Warehouse vs PostalAddress)

We have confirmed a major inconsistency between the `headless-commerce-admin-inventory` and `headless-admin-user` APIs based on real data samples.

**Warehouse (`reference-warehouses.json`)**:
- Uses **ISO a2** for `countryISOCode` (e.g., "GB", "US").
- Uses **Region Codes** for `regionISOCode` (e.g., "HAM", "CA").
- Region codes can be numeric strings (e.g., "14.0").

**PostalAddress (`reference-account.json`)**:
- Requires **Full Name** for `addressCountry` (e.g., "United States").
- Requires **Full Name** for `addressRegion` (e.g., "Texas").

**Action**: `WarehouseGenerator` has been updated to support longer region codes to match Liferay's internal data.

### Specification IDs and Categorization

By analyzing real Liferay responses (`reference-specifications.json`), we've refined how specifications are linked to products.

**Discovery**:
- While `optionCategoryId` handles the visual grouping, the `specificationId` is the primary identifier for the global specification definition.
- Proper linking requires a three-step process: (1) Ensure Group exists, (2) Ensure Specification exists with Group ID, (3) Link to Product with both Specification ID and Group ID.

**Action**: Refactored `ProductGenerator` to store resolved `specificationId`s in the product data list during the `ENSURE_SPECIFICATIONS` step, allowing the subsequent creation step to establish correct relationships.

## FATAL: GraphQL Filter Incompatibility (headlessAdminUser)

**Discovery**: During the "Delete All" run, any non-trivial filter passed to the `headlessAdminUser` namespace in GraphQL (e.g., querying accounts by an OR-joined list of IDs) triggered a fatal `Exception while fetching data : null` (500 error).

**Action**: Refactored all core discovery methods in `LiferayService` to use **REST** instead of GraphQL for list retrieval. GraphQL is now strictly reserved for high-performance aliased retrieval of known entities by ERC.
