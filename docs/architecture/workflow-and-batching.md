# Workflow State, Batch Correlation, and WebSocket Progress Specification

## Media Attachment Strategy

Media assets (Images and PDFs) must be submitted to Liferay via its Headless APIs using one of the following patterns:

- **URL-based**: Provide a publicly reachable URL (e.g., from a CDN or external provider like Picsum) to the `/by-url` endpoints.
- **Base64-based**: Submit file content as a Base64 string to the `/by-base64` endpoints.
- **Multipart**: Upload files using standard `multipart/form-data`.

**Live Mode**: Triggers real-time generation of images (e.g., via DALL-E) or PDFs (via jsPDF) and submits them to Liferay.
**Demo Mode**: Uses static placeholders, user-supplied assets, or skips attachment based on configuration.

### Dataset Portability & Replication

To ensure environment parity and support the "Replay" feature, the system mandates comprehensive data preservation:

1.  **Dependency Capture**: Generators MUST capture and store the full metadata of created foundation entities (Specification Categories, Specification Definitions, Option Definitions) in the session context.
2.  **Asset Metadata**: Media generators return metadata for created images and PDFs (ERC links, titles) to be persisted in the session, allowing these relationships to be reconstructed in new environments.
3.  **Ordered Import**: The backend import logic handles entities in their logical dependency order: Foundations (Warehouses, Specs, Options) followed by Primary Entities (Products, Accounts, Orders).
4.  **ERC-First Replication**: All exported data uses External Reference Codes as the primary linking mechanism to ensure stability across different Liferay instances.
5.  **Deterministic Child ERCs**: To prevent collisions and support iterative updates, child entities (Price Entries, Tier Prices, Inventory) MUST use deterministic ERCs built from their natural keys (e.g., `PE-{SKU}-{PRICELIST}`).
6.  **Verified Commerce Targets**: `catalogId`, `channelId` and `siteGroupId` are instance-specific and do not travel, so every run route (`routes/generate.cjs`, `routes/import.cjs`, the MCP `aica_trigger_generation` tool) resolves them through `utils/commerceSelection.cjs` before any step is composed. Two rules apply, and both exist because a run that quietly relocates costs more to find than one that stops (#680):
    - A **substitution** happens only when no id was requested, and the run reports which entity it filled in - in the logs, in the `commerce` block of the response, and in the console panel.
    - A **refusal** (HTTP 400) happens only on positive evidence that a requested id is absent: it is missing from the list _and_ a by-id read does not find it. Lists that cannot be read prove nothing, so the supplied ids are used exactly as given.

    `siteGroupId` is always taken from the resolved channel rather than trusted from the request, because the channel record is authoritative about which site it belongs to.

## Resuming a Failed Run

A failed session is re-entered at the step that failed rather than restarted
from the beginning (#895). The mechanism is deliberately small, because the
workflow engine already holds everything it needs:

1.  **Step state is derived, not stored.** `executeNextStep` reads each step's
    state off its `workflow_batches` rows - FAILED if any row failed, COMPLETE
    if every row is terminal, and PENDING when the step has no rows at all. A
    resume therefore never lists what still has to happen. It deletes the
    failed step's rows so the step reads PENDING again, moves the session out
    of `FAILED`, and hands it back to the orchestrator, which skips the
    completed steps using the same code a first run uses.
2.  **The session id is reused.** Not a convenience: `_resolvePriceListTargets`
    keys this run's price lists on an ERC containing the session id, and
    `_deleteStalePriceLists` removes catalogue lists that are not in that set.
    A resume under a new session id would delete the previous attempt's price
    lists and the entries in them.
3.  **Progress is untouched.** Every completed step keeps the rows its share of
    the bar was summed from, so a resumed run's progress means what a fresh
    one's means. Only the failed step's rows are replaced.

### The idempotency classification

`utils/stepIdempotency.cjs` classifies every key in `WORKFLOW_STEPS` by what a
second attempt leaves behind - `NO_WRITE`, `ERC_UPSERT`, `CONVERGES` or
`UNSAFE` - each entry citing the call site that decides it.
`tests/stepIdempotency.test.cjs` fails when a step has no entry, so a new step
is a new decision rather than an assumption. An unclassified step is treated as
`UNSAFE`.

### What resume refuses

`utils/resumePlan.cjs` answers with a refusal and a reason, never with a
partial guess:

- a failed step classified `UNSAFE` - running it again would duplicate rather
  than continue;
- a step still holding non-terminal batch rows, meaning a batch was submitted
  to Liferay and its callback never arrived - clearing it would abandon work
  that may still land, and leaving it would stall the advance;
- a session that is not `FAILED`.

### Surfaces

`POST /api/v1/workflows/sessions/:sessionId/resume`, and
`aica import --resume <sessionId>` on the CLI. The dataset is not re-sent: the
session already holds it, along with the catalog, channel, product and SKU ids
its earlier steps resolved.

### Known limits

- **Extract and export do not resume.** They do not run on the session/step
  machinery; `extractionFacade` is a separate path, and #972 covers the media
  half of extract.
- **A package import's media bundle is held in `cacheService`**, which is
  memory only (#877). A resume after a service restart reaches the attach steps
  with nothing to attach; they record `BYPASSED` rather than failing, so the
  run completes without its media.
- **`create-images` and `create-pdfs` remain `UNSAFE`.** Both POST an
  attachment with no external reference code. Neither can be a resume's entry
  point, because a media failure is recorded `BYPASSED` - which is terminal -
  so the planner never needs to re-enter one.

## Purpose

Define a clear, race-safe, event-driven architecture for multi-step
workflows (generation/deletion) that: - Maintain workflow context across
steps - Safely correlate async batch callbacks - Stream progress to the
frontend via WebSockets - Provide strong observability and
debuggability - Avoid race conditions, cache timing issues, and hidden
coupling

This specification is intended to be used as **AI context** when
building or refactoring the system.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-18_ | _Last Reviewed: 2026-09-18_
