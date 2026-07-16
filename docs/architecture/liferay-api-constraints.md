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

1.  **Product Visibility**: Every product must be linked to a channel via the **`/product-channels`** API. Without this, products will not appear in the storefront.
2.  **Inventory Visibility**: Every warehouse must be linked to a channel via the **`/warehouse-channels`** API. Without this, stock levels will remain at zero in the checkout, regardless of warehouse items.
3.  **ERC-First Resilience**: Always use the `by-externalReferenceCode` path for establishing these links to bypass search index lag.

---## Strict DTO Hardening

Liferay's newer Headless APIs (2024.Qx+) enforce strict metadata validation for nested relationships:

- **Full Metadata Objects**: Many DTOs (e.g., `Specification`) require a **Full Parent Object** instead of a flat ID.
  - _Correct_: `"optionCategory": { "id": 123, "key": "spec-group", "title": { "en_US": "Specs" } }`
  - _Incorrect_: `"optionCategoryId": 123`
- **Indexing Heartbeats**: Implement a **2-3 second delay** between linking a child to a parent (e.g., Options to Product) and performing dependent operations (e.g., creating SKUs or Inventory). This allows Liferay's internal relationship mapping to settle.
- **Pricing Resilience**: Pricing V2.0 strictly requires the **`discountDiscovery`** boolean in the `PriceEntry` DTO. Omitting it will cause a backend `NullPointerException`.

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
