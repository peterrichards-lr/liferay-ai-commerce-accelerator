## Liferay Accelerator SDK Modularization

To ensure architectural high-integrity and promote reusability across multiple accelerators, the system is split into two distinct layers:

### 1. Liferay Protocol & Engine Layer (`@liferay/accelerator-sdk`)

- **Responsibility**: Hardened communication and stateful workflow execution.
- **Components**:
  - **`LiferayService`**: High-level unified client (REST, GraphQL, Batch).
  - **`BaseGenerator`**: Master orchestrator for multi-step async workflows.
  - **`PersistenceService`**: SQLite-backed session and batch state management.
  - **`BatchCallbackService`**: Asynchronous reconciliation for Liferay Batch jobs.
  - **`OAuthService`**: Automated token lifecycle and platform-aware discovery.
  - **`GeneratedLiferayClient`**: Namespaced, version-aware fluent client.
- **Maintenance**: Stays in sync via `yarn sync` and `yarn generate` scripts.

### 2. Domain Orchestration Layer (Microservice)

- **Responsibility**: Accelerator-specific business logic and AI prompts.
- **Components**:
  - **Data Generators**: Specialized logic (Product, Account, Order).
  - **AI Integration**: Prompt engineering and provider management.
  - **Infrastructure**: Queue management (a self-contained `worker_threads`-based queue in `services/queueService.cjs` — not Redis-backed BullMQ) and WebSocket streaming.

---## Storage strategy

### Guiding principle

**Workflow execution state must not depend on Liferay availability or
Headless API latency.**

### Hybrid Persistence Model

The microservice employs two distinct storage layers to balance resilience, performance, and data isolation.

#### 1. Workflow Persistence Layer (`PersistenceService`)

This layer manages the canonical state of all asynchronous operations (sessions, batches, and events).

- **Primary Store (Source of Truth):**
  - A local **SQLite** database (`workflows.db`).
  - **Durability**: Preserved across process restarts, enabling session resumption and reliable audit trails.
  - **Schema**: Includes `workflow_sessions`, `workflow_batches`, and `workflow_events` tables.
- **Implementation (SQLite + better-sqlite3):**
  - Uses the `better-sqlite3` driver for high-performance, synchronous, atomic writes to ensure state integrity during concurrent callbacks.
- **Consistency Model (Write-Invalidate):**
  - **Reads**: Checks cache first; on miss, loads from SQLite and populates cache.
  - **Writes/Updates**: All mutations are written directly to SQLite first. Immediately following a successful write, the corresponding cache entry is **invalidated (deleted)**.

### Dataset packages: export, extract, import

A dataset is worth paying for once. The AI calls happen on the first run and
every instance after that is a replay, so the same catalogue is promoted
between instances rather than regenerated — a generated catalogue cannot be
reproduced, because generation is not deterministic.

Three operations share one package format (`.aicap`, a zip holding
`dataset.json` and `media/`). They differ in **cost and dependency**, not in
what they produce:

| Operation   | Route                                           | Reads                                                  | Needs                                    |
| ----------- | ----------------------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| **export**  | `GET /api/v1/export-commerce-bundle?sessionId=` | this service's session, plus the media archive on disk | nothing external                         |
| **extract** | `POST /api/v1/extract-commerce-bundle`          | a live Liferay instance                                | credentials, a round trip per attachment |
| **import**  | `POST /api/v1/import-commerce-data`             | a package (or a bare JSON dataset)                     | write access to the target               |

`GET /api/v1/export-commerce-data` remains the dataset-only JSON export, with
no media.

**All three are drivable from the Dashboard and the CLI** — `aica export
--bundle`, `aica extract`, `aica import` — and `tests/surfaceParity.test.cjs`
fails the build when any endpoint can be driven from no surface at all. Full
parity is not the claim: some endpoints belong to a container probe, a callback
or a support session. The claim is that every omission is a written reason
rather than an oversight, which is what #880 asked for.

**Both producers stage through the media archive**, and that is what makes the
cheap route possible. `utils/mediaArchive.cjs` writes each binary to
`~/.aica/media/<sessionId>/` — beside the workflow database, outside the
repository, because state inside a checkout gets destroyed by ordinary tooling
(#868, #869, #899):

```text
~/.aica/media/<sessionId>/
  manifest.json
  images/<productERC>-<priority>.webp
  attachments/<productERC>-<sku>.pdf
```

Two directories, not one per format. The manifest carries each entry's `kind`
and the counts keep images and PDFs apart, so the directory only has to be a
place to put a file — and the next format to arrive (a CAD model, a
high-resolution render, a 3D/AR asset) is an attachment as far as the disk is
concerned (#901). A package unpacked beside a session directory reads the same,
because both use the same rule. Packages written earlier name their entries
`media/pdfs/…` and still import: a file is resolved by the path its own
manifest gives. A generation run writes each file _before_ uploading it, so
a rejected upload leaves something usable behind; an extract writes each
binary as it arrives and releases it, so the peak is one attachment rather
than the whole catalogue.

There is no switch that stops the writing: staging is how a package is built,
so skipping it would produce a package with no pictures and no error.
`MEDIA_ARCHIVE_RETAIN` decides only whether a directory staged _purely to build
a package_ — an extract against a live instance, which has no session behind it
— survives the package it produced.

**An extract against a session repairs that session's archive.** Pull the
binaries once, and every later export of it is a directory read. When the run
recorded media and the archive can supply none, the export **refuses with 409**
and names extract — a package that quietly carries a catalogue with no pictures
is the failure the whole feature exists to prevent.

**Media outlives its session only until the next sweep.** A directory whose
session id is no longer in `workflows.db` is garbage however it went —
`clear-all`, `cleanup`, a row removed by hand — so it is swept at startup and
after both routes, alongside the age (`MEDIA_ARCHIVE_RETENTION_HOURS`) and
count (`MEDIA_ARCHIVE_MAX_SESSIONS`) prune. Extract staging directories are
exempt by name: having no session is what they are.

**Both producers report the same four counts**, as response headers and inside
`media/manifest.json`:

| Header                                      | Reads                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `X-AICA-Media-Images` / `X-AICA-Media-Pdfs` | what the package carries                                                                  |
| `X-AICA-Media-Unresolved`                   | media the source recorded that the package does **not** carry                             |
| `X-AICA-Products-Incomplete`                | products missing a field the schema **requires** — these cannot be imported as they stand |
| `X-AICA-Products-Partial`                   | products missing optional fields only, usually because they are blank on the source       |
| `X-AICA-Media-Source`                       | `archive` or `instance` — which producer built it                                         |

The last two exist because one number conflating them fired on every healthy
run and was therefore ignored (#886). Anything above zero in the first three
means the package is thinner than its source; per-product detail is in
`metadata.translationReport` inside the package.

---

## AI Multi-Provider Strategy (Text vs. Media)

To provide maximum flexibility and cost optimization, the microservice supports independent AI drivers for different content types.

1.  **Independent Keys**: Text generation (Products, Accounts, Orders) and Media generation (Images, PDFs) can be configured with separate API keys and providers.
2.  **Nano Banana Support**: Dedicated provider for specialized image generation.
3.  **Intelligent Fallback**: Media tasks will automatically fall back to the Core AI provider if no dedicated media key is provided, ensuring seamless operation for single-provider setups.
4.  **Provider Factory**: All AI interactions must go through `providerFactory.cjs` to ensure consistent error handling and model normalization.

### Provider Capability Matrix

| Provider         | Core data (products, accounts, orders) | Media (images)       |
| :--------------- | :------------------------------------- | :------------------- |
| OpenAI           | ✅                                     | ✅ DALL·E            |
| Google Gemini    | ✅                                     | ✅                   |
| Anthropic Claude | ✅                                     | ❌ **not supported** |
| Nano Banana      | —                                      | ✅                   |

Claude generates data only. The "intelligent fallback" above — media inheriting the core provider when no dedicated media key is set — therefore cannot work when the core provider is Claude, because there is nothing to fall back to.

That combination is checked in three places, all sharing one message so the fix reads identically wherever it is met:

1. **Configuration panel** — a warning appears against the Media Provider when the effective provider cannot produce images. This is the earliest point, and the only one where the user is already looking at the setting that fixes it.
2. **Startup** — a warning is logged when the persisted configuration has the same combination. Configuration can be changed directly in the Liferay object or restored from a `.ldmp` without passing through the panel, so the panel cannot be the only guard. A warning rather than a failure, since an instance that never generates images is still usable.
3. **Generation time** — an error before any product is processed, when `imageMode` is `ai` and the effective provider cannot produce images. This catches configuration changed after startup, and fails before the loop so no products are left half-processed.

The other image modes — `placeholder`, `picsum`, `default`, `custom`, and `ai` under demo mode — call no provider, so the constraint does not apply to them.

The logic lives in `utils/providerCapabilities.cjs` and its counterpart in the configuration client extension, deliberately parallel so the wording cannot drift between the UI and a failed run.

---## Demo mode and the generation contract

Demo mode exists so a run costs nothing, on the understanding that it proves the same pipeline live mode uses. That only holds if the mock stands in for the same thing the model does, so the contract is fixed rather than a matter of taste.

### The mock stands in for `aiService`, not for Liferay

`GenerationFacade.generateData` selects `ctx.mockDataGenerator` in place of `ctx.ai` when `demoMode` is set, and everything after that point is identical: the same standardise pass, the same ajv validation against `generation-schemas/<entity>.json`, the same product steps, the same import.

So **mock output must be what the AI is asked to return**. Translating into Liferay's DTOs is the product steps' job, and doing it early in the mock does not save that work — it skips it, and with it the only coverage those steps get without a model call.

Concretely, `generators/mockDataGenerator.cjs` emits `options` and `specifications`, not `productOptions` and `productSpecifications`. Those are not two names for one thing: in Liferay an `Option` is a definition with its own endpoint, while a `ProductOption` is the relationship between an option and a product. The generation schemas describe the first; the product steps derive the second. Five files read either name at thirteen sites, so emitting the translated shape did not fail — it simply sent demo mode down a different branch than live mode takes.

### A property the schema does not declare cannot exist in live mode

The schema sent to the provider is projected from the generation schema by `utils/schemaProjection.cjs`, with objects closed. A property the generation schema does not declare therefore cannot come back from a model at all.

That makes an undeclared property in the mock demo-only data, and any pipeline behaviour depending on it untested where it matters. Ajv will not catch it either, because the product item permits additional properties.

### Enforcement

`tests/mockMatchesGenerationSchemas.test.cjs` asserts both halves for every entity `MockDataGenerator` produces, and derives the entity list from `generation-schemas/` so a new schema cannot be added without a decision being recorded:

1. The payload survives the real `GenerationFacade` with `demoMode: true` — the gate a demo run puts it through, not a schema compiled in isolation.
2. Every property it emits is declared by that schema.

`generation-schemas/` remains the single authority. Where the mock and the schema disagree, the mock is wrong.

### Every text generator goes through the facade

Product, account, order, warehouse, pricing and promo all route through `GenerationFacade.generateData`, which is what makes the substitution — and the schema validation behind it — apply uniformly. A generator that calls `ctx.ai` directly bypasses both: `PromoGenerator` did, so a demo run with promotions enabled still called a model, and its response was never schema-checked.

Media is the deliberate exception. `mediaGenerator` checks `options.demoMode` itself and skips the provider for both images and PDFs, substituting placeholders rather than generated content, so `pdf` has a generation schema with no mock behind it.

---## Dynamic Asset Management

The microservice serves as the source of truth for product placeholders, moving away from heavy frontend-bundled Base64 strings.

1.  **File-Based Storage**: Images are stored in `public/placeholders/` within the microservice.
2.  **Lazy Conversion**: Assets remain binary on the server and are only converted to Base64 strings when a user selects them in the Configuration UI to update Liferay's global settings.
3.  **Auto-Derived Labeling**: The UI gallery automatically generates professional titles (e.g., "Liferay Product Default") from filenames (`liferay_product_default.webp`), eliminating the need for a metadata database.
4.  **Sanitized Custom Uploads**: User-uploaded images are sanitized to `snake_case` filenames and deduplicated with timestamps to ensure filesystem consistency.

---## Core identifiers

### sessionId

Primary identifier for a workflow run and UI subscription.

### erc

Primary identifier for a batch submission and callback correlation.

### wsCorrelationId

Identifier for correlating WebSocket messages and logs.

### errorRef

Identifier for correlating user-visible errors and server logs.

---

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-11_ | _Last Reviewed: 2026-09-11_
