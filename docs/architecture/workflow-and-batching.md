# Workflow State, Batch Correlation, and WebSocket Progress Specification

## Media Attachment Strategy

Media assets (Images and PDFs) must be submitted to Liferay via its Headless APIs using one of the following patterns:

- **URL-based**: Provide a publicly reachable URL (e.g., from a CDN or external provider like Picsum) to the `/by-url` endpoints.
- **Base64-based**: Submit file content as a Base64 string to the `/by-base64` endpoints.
- **Multipart**: Upload files using standard `multipart/form-data`.

**Live Mode**: Triggers real-time generation of images (e.g., via DALL-E) or PDFs (via jsPDF) and submits them to Liferay.
**Demo Mode**: Uses static placeholders, user-supplied assets, or skips attachment based on configuration.

### Object Storage Service Role

The `ObjectStorageService` is **not** used for hosting assets for Liferay consumption. Its purpose is restricted to:

1.  **Data Preservation**: Storing generated AI payloads, images, and documents for offline analysis.
2.  **Export/Import Support**: Enabling the "Replay" feature where a full generation run can be reconstructed without re-invoking AI models.

### Dataset Portability & Replication

To ensure environment parity and support the "Replay" feature, the system mandates comprehensive data preservation:

1.  **Dependency Capture**: Generators MUST capture and store the full metadata of created foundation entities (Specification Categories, Specification Definitions, Option Definitions) in the session context.
2.  **Asset Metadata**: Media generators return metadata for created images and PDFs (ERC links, titles) to be persisted in the session, allowing these relationships to be reconstructed in new environments.
3.  **Ordered Import**: The backend import logic handles entities in their logical dependency order: Foundations (Warehouses, Specs, Options) followed by Primary Entities (Products, Accounts, Orders).
4.  **ERC-First Replication**: All exported data uses External Reference Codes as the primary linking mechanism to ensure stability across different Liferay instances.
5.  **Deterministic Child ERCs**: To prevent collisions and support iterative updates, child entities (Price Entries, Tier Prices, Inventory) MUST use deterministic ERCs built from their natural keys (e.g., `PE-{SKU}-{PRICELIST}`).

## Purpose

Define a clear, race-safe, event-driven architecture for multi-step
workflows (generation/deletion) that: - Maintain workflow context across
steps - Safely correlate async batch callbacks - Stream progress to the
frontend via WebSockets - Provide strong observability and
debuggability - Avoid race conditions, cache timing issues, and hidden
coupling

This specification is intended to be used as **AI context** when
building or refactoring the system.
