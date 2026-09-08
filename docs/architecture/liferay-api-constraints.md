## OData Filtering & API Constraints

To ensure maximum compatibility across Liferay's diverse Headless API implementations (specifically verified on **DXP 2025.Q1**), the following OData and filtering patterns must be strictly followed:

### 1. The "Filter-In-Memory" Mandate

Empirical testing confirms that Liferay's REST and GraphQL engines are inconsistent when handling complex filters.

- **The Rule**: **NEVER** use complex OData filters (e.g., `ne`, `not`, or deep `or` conditions) for discovery.
- **The Pattern**: Fetch all relevant items using a simple, stable filter (like `catalogId eq 123` or no filter at all) and perform all exclusions, prefix matching (`AICA-`), and UUID pattern verification strictly in **JavaScript memory**.
- **Rationale**: This bypasses "400 Bad Request" errors on unstable fields (like `name`) and prevents the "Fatal GraphQL death filter" bug.

### 2. Implementation Caveats & Mandatory Patterns

- **Operator Ban (`sw` and "startswith")**: **NEVER** use `sw` or `startswith()` operators for prefix filtering. These operators are inconsistently supported and frequently trigger `DataFetchingException: null` (500 error) in Liferay's Headless GraphQL fetchers, particularly for `headlessAdminUser`.
- **FATAL: GraphQL Filter Bug**: Empirical testing confirms that **ANY** complex filter on the `headlessAdminUser` namespace (e.g., `id eq ... or id eq ...`) can trigger a fatal `null` exception in Liferay's data fetchers.
- **Regional Metadata Fallbacks**: Liferay's Headless API for Addresses strictly validates the `addressRegion` field. Providing placeholder strings like "N/A" will result in a `400 Bad Request`. Always provide `null` if a region cannot be determined.

## Indirect Relationship Glue (Liferay Commerce 2025.Q1)

In newer Liferay Commerce versions, Catalogs and Channels are decoupled. For a store to function, the "Glue" must be explicitly established via indirect relationships:

1.  **Product Visibility**: Every product must be linked to a channel. Without this, products will not appear in the storefront.
2.  **Inventory Visibility**: Every warehouse must be linked to a channel via the **`/warehouse-channels`** API. Without this, stock levels will remain at zero in the checkout, regardless of warehouse items.
3.  **ERC-First Resilience**: Always use the `by-externalReferenceCode` path for establishing these links to bypass search index lag.

### Writing a product-to-channel link

`/product-channels` is **read and delete only** — `products/{id}/product-channels` and its `by-externalReferenceCode` twin expose `GET`, and `product-channels/{id}` exposes `GET` and `DELETE`. There is no `POST`. The association can only be written through the product itself, whose DTO carries `productChannels` as a nested collection, so either:

- send `productChannels` when creating the product (`create-products` does this for every channel the run names), or
- `PATCH` the product with `productChannels` afterwards (`link-product-channels` does this to attach a later run's channel to an existing catalogue).

**The PATCH replaces, it does not append.** `ProductResourceImpl`'s update path calls `deleteCommerceChannelRels` for the whole product and then re-adds exactly what the payload names, so a PATCH must always carry the union of the channels the product already has and the ones being added. Read the current set from `GET .../product-channels` first.

`productChannelFilter` is a separate field from `productChannels`, and adding channels does not turn it on. It defaults to `false` on create, and Liferay keeps the existing value when the field is absent from a PATCH. While it is `false`, `CPDefinition.channelFilterEnabled` is `false` and the channel rels do not restrict anything — see [Channel eligibility is not enforced on the admin-order path](#channel-eligibility-is-not-enforced-on-the-admin-order-path).

### Channel eligibility is not enforced on the admin-order path

Liferay does have a channel-eligibility check for order items — `VisibilityCommerceOrderValidatorImpl._isChannelEnabled`, which looks up a `CommerceChannelRel` keyed on the `CPDefinition` and the order's channel, and fails with `one-or-more-products-are-no-longer-available`. It is gated twice, and AICA's generation path clears both gates:

- The check short-circuits to `true` unless `CPDefinition.channelFilterEnabled` is set, and AICA never sends `productChannelFilter`.
- `OrderItemUtil.addCommerceOrderItem` and `addOrUpdateCommerceOrderItem` in `headless-commerce-admin-order` both call `ExportImportThreadLocal.setPortletImportInProcess(true)` as their first instruction, and `CommerceOrderItemLocalServiceImpl._validate` skips the entire `CommerceOrderValidatorRegistry` chain while an import is in process. `POST /orders` with nested `orderItems` goes through the same helper.

The only product-side validation the admin-order API performs is that the SKU id or ERC resolves to a `CPInstance` in the same **company** — not the catalog, and not the channel.

`headless-commerce-delivery-cart` (`CartItemResourceImpl`) does **not** set the import flag, so the validator chain does run for a real shopper adding to a cart.

Verified against `dxp-2026.q1.7-lts` bytecode. The practical consequence: an unlinked product produces orders Liferay accepts but a storefront cannot browse, so missing links are a visibility defect on the generation path rather than an order-creation failure.

---## Strict DTO Hardening

Liferay's newer Headless APIs (2024.Qx+) enforce strict metadata validation for nested relationships:

- **Full Metadata Objects**: Many DTOs (e.g., `Specification`) require a **Full Parent Object** instead of a flat ID.
  - _Correct_: `"optionCategory": { "id": 123, "key": "spec-group", "title": { "en_US": "Specs" } }`
  - _Incorrect_: `"optionCategoryId": 123`
- **Indexing Heartbeats**: Implement a **2-3 second delay** between linking a child to a parent (e.g., Options to Product) and performing dependent operations (e.g., creating SKUs or Inventory). This allows Liferay's internal relationship mapping to settle.
- **Pricing Resilience**: Pricing V2.0 strictly requires the **`discountDiscovery`** boolean in the `PriceEntry` DTO. Omitting it will cause a backend `NullPointerException`.

### `neverExpire` defaults the opposite way for products and SKUs

An omitted `neverExpire` does not mean the same thing on both halves of a product payload, and the SKU half is the dangerous one:

| Payload   | Read as                                                                             | Effect of omitting it                                                                                                     |
| :-------- | :---------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| `Product` | `GetterUtil.getBoolean(product.getNeverExpire(), true)` (`ProductResourceImpl:739`) | Never expires.                                                                                                            |
| `Sku`     | `GetterUtil.get(sku.getNeverExpire(), false)` (`SkuUtil:232`)                       | Expires. With no `expirationDate` alongside it, `DateConfig.toExpirationDateConfig` sets one exactly **one month** ahead. |

The SKU is Approved and purchasable on the day it is created — `expirationDate.before(date)` is false, so nothing is visibly wrong. About thirty days later `CheckCPInstanceSchedulerJobConfiguration` runs `_checkCPInstancesByExpirationDate` (`CPInstanceLocalServiceImpl:1617-1641`), the SKU becomes `STATUS_EXPIRED`, and the storefront stops listing it (`SkuResourceImpl:213-222` only reads Approved instances) while the product above it stays Approved and complete-looking.

- **The rule**: send `neverExpire` explicitly on **every** `Product` and `Sku` payload. `neverExpire: true` leaves the column null (`CPInstanceLocalServiceImpl:159-164` and `:1052-1057` only compute an expiry when `!neverExpire`), and a null expiry can never match the sweeper's finder.
- **Updates do not merge it.** Both resources read the field from the payload with the same defaults on update as on create, so a PATCH or UPSERT that omits `neverExpire` resets it — a product meant to expire is silently un-expired by any later write that leaves the field out.
- **It is write-only.** `SkuDTOConverter` never sets `neverExpire` on read, so a GET will not echo it back. Read `expirationDate` instead: null means it never expires.
- **Configured, not hardcoded**: the `catalog-expiry-config` entry (`neverExpire`, `expiryDays`) decides this per environment; a missing entry resolves to `neverExpire: true`. See `utils/catalogExpiry.cjs`.

Verified against `liferay-portal` 7.4.3.141 (`cb125431de`).

---## Liferay v2.0 Pricing & Batch APIs (Engineering Rules)

Extensive empirical testing against Liferay DXP (2025.Q1) revealed strict constraints regarding the `v2.0` Headless Pricing API and the Headless Batch Engine:

### 1. Batch Endpoints: POST vs PUT

- **Rule**: Liferay's Headless Batch Engine endpoints (e.g., `/v2.0/price-lists/price-entries/batch`) **strictly expect the HTTP `POST` method** for batch creation operations.
- **The Pitfall**: Attempting to use `PUT` for UPSERT behavior on these endpoints will result in a `405 Method Not Allowed`.
- **The Implication**: Since `POST` strictly performs a `CREATE` operation, sending a batch payload containing ERCs that already exist in the database will immediately trigger a `400 Bad Request` ("This external reference code is already in use"). You must clean/delete prior entries before generating new ones with the same ERCs.

### 2. Batch Tracking Query Parameter Collision

- **Rule**: When using a `/batch` endpoint, Liferay intercepts the `externalReferenceCode` URL query parameter and assigns it to the **Batch Import Task** itself (not the target entity).
- **The Pitfall**: If you incorrectly pass a target entity ERC (like `AICA-PL-GENERAL` for a Price List) in the query string (`?externalReferenceCode=AICA-PL-GENERAL`), Liferay will attempt to assign the Price List's ERC to the newly created Batch Task. This causes an immediate `400 Bad Request` collision.
- **The Pattern**: Always pass a dynamically generated, unique `batchERC` (e.g., `AICA-BATCH-12345`) in the query parameter to allow tracking via WebHooks, and define the target relationships strictly inside the JSON payload items.

### 3. Strict Pricing DTO Schemas

Liferay's Java deserializer for `PriceEntry` is extremely unforgiving. The JSON payload MUST exactly match the expected Object structure:

- **Nested SKU Object**: The `sku` property MUST be a nested object wrapper (e.g., `"sku": { "externalReferenceCode": "..." }` or `"sku": { "id": 123 }`). Sending a flat string (e.g., `"sku": "SKU-123"`) will trigger a Java constructor exception (`no String-argument constructor/factory method to deserialize from String value`).
- **Required Booleans**: The `hasTierPrice` boolean MUST be explicitly provided.
- **Extraneous Fields**: Do NOT send internal microservice state flags (like `bulkPricing` or `discountDiscovery`) in the payload, as the strict DTO validation will reject unknown properties.

### 4. Recursive ERC Deduplication

Liferay evaluates batch payloads recursively. If a single payload contains nested arrays (like `tierPrices` inside `priceEntries`), all ERCs within that nested array must be mathematically unique across the entire payload.

- **The Pitfall**: If the AI hallucinates two duplicate `tierPrices` (e.g., two entries for "minimum quantity: 10"), generating an identical `externalReferenceCode` for both, the entire batch will fail with "already in use", even on a clean database.
- **The Pattern**: Aggressively deduplicate nested properties (e.g., using a `Set` on `minimumQuantity`) in memory _before_ assembling the Liferay DTO.

---

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-08_ | _Last Reviewed: 2026-09-08_
