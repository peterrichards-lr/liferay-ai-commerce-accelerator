# Dataset Import Specification

## Overview

The "Dataset Import" feature allows users to upload a JSON file containing pre-generated or exported commerce data (Products, Accounts, Orders, Warehouses, etc.) and have the microservice ingest it into a target Liferay instance.

This differs from standard generation in that it skips the AI/Mock data generation phase and instead uses the provided data as the source of truth, while still leveraging the orchestrator's resilient linking and resolution logic.

## Functional Requirements

1.  **JSON Ingestion**: Support `POST /import-commerce-data` with a multipart file upload.
2.  **Workflow Integration**: Trigger a standard generation workflow but bypass the `GENERATE_*_DATA` steps.
3.  **Data Injection**: Inject the parsed JSON data into the session context (e.g., `productDataList`, `accountDataList`, etc.).
4.  **Normalization**: Ensure imported data has stable ERCs. If missing, generate them deterministically.
5.  **Foundation Sync**: Ensure Warehouses, Specifications, and Options are synchronized before primary entities.
6.  **Progress Tracking**: Stream progress via WebSockets just like a standard generation run.

## Data Structure (Schema)

The import file should follow the same structure as the internal `SessionContext` or the export format:

```json
{
  "products": [...],
  "accounts": [...],
  "orders": [...],
  "warehouses": [...],
  "specificationDefinitions": [...],
  "optionDefinitions": [...]
}
```

## Architecture

### 1. Route Layer (`routes/import.cjs`)

- Validates the uploaded file.
- Parses JSON.
- Builds a workflow `steps` array based on the present entities.
- Initializes a `WorkflowCoordinator` session.

### 2. Generator Layer

- `ProductGenerator`, `AccountGenerator`, `OrderGenerator` must be updated to:
  - Check if data already exists in `session.context` for their respective entity type.
  - Skip the generation call if data is present.
  - Perform normalization/cleaning on the imported data.

### 3. Orchestration

- Use the `WorkflowCoordinator` to handle multi-entity dependencies (e.g., Accounts before Orders).

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
