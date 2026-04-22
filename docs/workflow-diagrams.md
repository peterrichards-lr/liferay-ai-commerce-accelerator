# Microservice Workflow Sequence Diagrams

This document contains sequence diagrams illustrating the primary workflows of the `ai-commerce-accelerator-microservice`.

---

## 1. Generation Workflows

The microservice supports two primary modes for generating data (Products, Accounts, Orders, etc.), depending on the requested count and configuration.

### 1.1 Batch Mode (Count > 1)
Optimized for high-volume generation. Uses Liferay's Batch Engine for asynchronous processing and follows a step-by-step state machine.

```mermaid
sequenceDiagram
    participant MS as Microservice (Orchestrator)
    participant DB as SQLite (Persistence)
    participant LR_Batch as Liferay Batch Engine
    participant WS as WebSocket (Progress)

    Note over MS: Data Generation Phase (Live or Demo)
    MS->>DB: createBatch(erc, status: 'PREPARED')
    MS->>+LR_Batch: POST /batch (Callback URL + ERC)
    LR_Batch-->>-MS: 201 Created (Batch ID)
    MS->>DB: updateBatch(status: 'SUBMITTED', batchId)
    MS->>WS: Emit: batch_started (totalCount: N)

    Note over LR_Batch: Async Processing in Liferay...

    LR_Batch->>+MS: POST /callback?batchERC={erc}
    MS->>DB: updateBatch(status: 'COMPLETED')
    MS->>WS: Emit: batch_completed (processedCount: N)
    MS->>-MS: triggerNextStep()
```

### 1.2 Individual Mode (Count = 1)
Used for low-volume requests or when `batchSize` is set to 1. Executes synchronous Headless API calls for immediate feedback.

```mermaid
sequenceDiagram
    participant MS as Microservice (Orchestrator)
    participant DB as SQLite (Persistence)
    participant LR_API as Liferay Headless API
    participant WS as WebSocket (Progress)

    Note over MS: Data Generation Phase (Live or Demo)
    MS->>DB: createBatch(erc, status: 'SYNCHRONOUS')
    MS->>WS: Emit: batch_started (totalCount: 1)
    
    MS->>+LR_API: POST /entities (Single Payload)
    LR_API-->>-MS: 201 Created (Entity JSON)
    
    MS->>DB: updateBatch(status: 'COMPLETED')
    MS->>WS: Emit: batch_completed (processedCount: 1)
    MS->>MS: triggerNextStep()
```

---

## 2. Live vs. Demo Mode (Data Generation)

This sub-workflow happens at the start of every creation step (e.g., `product-data-generation`).

```mermaid
graph TD
    Start[Start Step] --> Mode{Mode?}
    Mode -- Live --> AI[AI Service: Request Synthetic Data]
    AI --> Schema[Validate against AI JSON Schema]
    Schema --> Persist[Store generated payload in Session Context]
    
    Mode -- Demo --> Mock[MockData Generator: Generate deterministic data]
    Mock --> Persist
    
    Persist --> End[Continue to Creation Step]
```

---

## 3. Deletion Workflows

Deletion is orchestrated by the `DeleteCoordinatorService` to ensure data is removed without violating referential integrity.

### 3.1 Full Environment Deletion (All)
Wipes all data in a hardcoded, safe sequence after performing a global discovery.

```mermaid
sequenceDiagram
    participant MS as Microservice (Orchestrator)
    participant LR as Liferay (Batch & API)
    
    Note over MS: Fixed Sequence:
    MS->>LR: 1. DISCOVER (Build Manifest)
    MS->>LR: 2. Reset Catalog Configuration
    MS->>LR: 3. Delete Orders
    MS->>LR: 4. Delete Warehouse Items
    MS->>LR: 5. Delete Warehouses
    MS->>LR: 6. Delete Accounts
    MS->>LR: 7. Delete Products & SKUs
    MS->>LR: 8. Delete Pricing & Promotions
    MS->>LR: 9. Global Cleanup (Options/Specs)
```

### 3.2 Selected Data Deletion
Allows users to target specific categories (e.g., only "Accounts"). Automatically performs discovery first to ensure accurate targeting.

```mermaid
sequenceDiagram
    participant User
    participant MS as Microservice (Orchestrator)
    participant LR as Liferay (Batch & API)

    User->>MS: POST /delete-selected (Scope: [Accounts, Pricing])
    MS->>MS: Prepend DISCOVER Step
    MS->>MS: dependencyCheck(Pricing) -> Prepend ResetCatalogConfig
    
    loop For each Step (Starting with DISCOVER)
        MS->>LR: Execute Deletion/Discovery Step
    end
```

---

## 5. Detailed Entity Sequences

### 5.1 Account Generation Sequence
Handles specialized address establishment (Head Office vs. Billing/Shipping) which requires multiple batch/API loops.

```mermaid
sequenceDiagram
    participant MS as Microservice
    participant LR as Liferay (Batch & API)

    Note over MS: 1. Generate Accounts (Batch)
    MS->>LR: createAccountsBatch() (Includes Head Office 'other' address)
    LR-->>MS: Callback (Success)
    
    Note over MS: 2. Resolve IDs
    MS->>LR: resolveByERCsWithRetry()
    LR-->>MS: Map of ERC -> Account ID
    
    Note over MS: 3. Create Specialized Addresses
    MS->>LR: createAddressesBatch() (Type: billing/shipping)
    LR-->>MS: Callback (Success)
    
    Note over MS: 4. Link Default IDs
    MS->>LR: Update Accounts (Set billingAddressId/shippingAddressId)
    LR-->>MS: 200 OK
```

### 5.2 Order Generation Sequence
Depends on existing Products, Accounts, and Warehouses.

```mermaid
sequenceDiagram
    participant MS as Microservice
    participant LR as Liferay (GraphQL & API)

    Note over MS: 1. Dependency Discovery
    MS->>LR: getProductsAndAccounts() (GraphQL Search)
    LR-->>MS: Product & Account Lists
    
    Note over MS: 2. Data Generation (Live or Demo)
    MS->>MS: generateOrderDataList() (Using AI or Mock)
    
    Note over MS: 3. Submit Orders
    alt Count > 1
        MS->>LR: createOrdersBatch()
        LR-->>MS: Callback (Success)
    else Count == 1
        MS->>LR: createOrderIndividually()
        LR-->>MS: 201 Created
    end
```
