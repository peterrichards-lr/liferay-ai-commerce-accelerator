# Persona Orders Implementation Plan

`MS/` and `FE/` as in the [spec](./spec.md). Microservice tests are Vitest
under `MS/tests/`; frontend tests are colocated `*.test.js(x)` under `FE/`
(there is no `tests/` folder there). Every PR runs `yarn lint` and `yarn test`
(the required `CI/build-and-test` check).

## Phase 0: Issues (file before any PR)

Each needs description, analysis and plan before `gh pr create`. Proposed:

1. **Epic/tracking:** "Generated orders have no buying behaviour per account"
   - the findings in spec section 2-3, linking #474.
2. "Order planner: persona catalogue and deterministic order plan" (Phase 1).
3. "Demo-mode orders are round-robin, one line each, with status shuffled
   independently of date" (Phase 2; bug-flavoured, cites `mockDataGenerator.cjs:554-601`
   and `orderGenerator.cjs:318-354`).
4. "Live orders: the model sees 10 accounts and 10 products per chunk and each
   chunk re-decides behaviour" (Phase 3; cites `aiService.cjs:1541-1553`). The
   fixed 10-item window is now filed as #1474.
5. "Segments assign the same first two accounts to every group" (Phase 4,
   `PromoGenerator.cjs:223`) - a bug on its own, now filed as #1473.
6. "E2E reads no order back" (Phase 5).

## Phase 1: Planner, no wiring (1 PR)

- **New** `MS/utils/orderPersonas.cjs`: frozen catalogue keyed by account type
  (`business`, `person`, neutral). Each persona: `id`, `label`, `weight`,
  `cadenceDays`, `linesPerOrder [min,max]`, `quantity [min,max]`,
  `affinity` (favourite-SKU count).
- **New** `MS/utils/orderPlan.cjs`: `planOrders({ accounts, skus, count,
rangeDays, distribution, now })` returning `[{ accountId,
accountExternalReferenceCode, personaId, orderDate, orderStatus, items }]`.
  Persona by `hash32` from `MS/utils/shareSelection.cjs`; count split by
  largest-remainder so the total is exact; statuses from `orderDistribution`
  ordered by date (oldest completed).
- **Tests** `MS/tests/orderPlan.test.cjs`: exact count; same input gives the
  same plan; dates within `[now - rangeDays, now]`; `rangeDays: 0` gives "now";
  `person` accounts never get a B2B persona and vice versa; items only from the
  supplied SKUs; status counts equal the distribution; statuses monotonic in
  date; 5,000 accounts x 50,000 orders under a time budget; zero SKUs or
  zero accounts throws the existing messages.

## Phase 2: Demo mode on the planner (1 PR)

- `MS/generators/mockDataGenerator.cjs` `generateOrderData`: call `planOrders`
  with `options.orderDateRangeDays`, `orderDistribution`, `generateSkuVariants`
  (via `orderableSkus`). Output stays within `order.json`.
- `MS/generators/orderGenerator.cjs:318-354`: skip the shuffle when every order
  already carries a planned status; keep it for imports and model output.
- **Tests:** `MS/tests/mockMatchesGenerationSchemas.test.cjs` (still passes,
  add `orderDateRangeDays`/`orderDistribution` to the order case);
  `MS/tests/orderGenerator.test.cjs` (planned status not reshuffled; import path
  unchanged); a mock test asserting multi-line baskets and more than one order
  for at least one account when `count > accounts`.

## Phase 3: Live mode chooses personas (1-2 PRs)

- **New** `MS/prompts/persona.md`, `MS/generation-schemas/persona.json`
  (`assignments[{ accountId, personaId (enum from catalogue), rationale }]`),
  constant next to `ORDER_DATA_AI_SCHEMA` in `MS/utils/constants.cjs:87-91`,
  facade entity `persona` in `MS/services/generationFacade.cjs`, chunked
  `generatePersonaData` in `MS/services/aiService.cjs`, mock counterpart (hash
  choice) in `mockDataGenerator.cjs`.
- `orderGenerator.cjs` `_runOrderDataGenerationStep`: one persona call, then
  `planOrders` with those assignments; unknown or missing `personaId` falls
  back to the hash choice and is logged.
- Retire `MS/prompts/order.md` and `order.json` only if question 3 is answered
  that way; otherwise keep them for the import validator.
- Run `./gradlew generateBatchFiles` (renumbers generated batch files) and
  `UPDATE_PROMPT_CORPUS=1 yarn test promptRendering`; add corpus fixture in
  `MS/tests/fixtures/promptCorpus.cjs`.
- **Tests:** `promptRendering`, `promptSchemaTypes`, `schemaAlignment`,
  `mockMatchesGenerationSchemas` (persona entity), an aiService chunking test
  (assignments cover every account across chunks), `orderGenerator.test.cjs`
  (fallback on bad `personaId`).
- Split point if large: 3a schema/prompt/batch files, 3b wiring.

## Phase 4: Persona visible in Liferay (1 PR)

- New step after `CREATE_ORDERS` (or in `GENERATE_ORDER_DATA`), constant in
  `MS/utils/constants.cjs`: create one `AICA-SEG-PERSONA-*` account group per
  persona in use and assign AICA-owned accounts, reusing
  `createAccountGroup`/`assignAccountToGroup` as `PromoGenerator.cjs:197-240`
  does (idempotent; 409 already handled for promotions, #1455).
- `MS/generators/PromoGenerator.cjs:223`: assign by persona membership when a
  plan exists, otherwise spread accounts across segments instead of `slice(0, 2)`.
- **Tests:** `MS/tests/PromoGenerator.test.cjs`, a new step test; delete
  coverage already exists (`deleteCoordinatorService.cjs:263-264`) - add an
  assertion that persona groups are in the manifest.

## Phase 5: Verification and docs (1 PR)

- `playwright/tests/e2e/dashboard.spec.js`: after the existing Demo run, a
  read-back test like the product one (`:98-158`): list orders from
  `/o/headless-commerce-admin-order/v1.0/orders` with AICA ERCs, then assert
  (a) the count matches, (b) `orderDate`s span more than one day, (c) per
  account, older orders are not less complete than newer ones, (d) at least one
  order has more than one item, (e) persona account groups exist with members.
  Raise demo counts from 2 accounts/5 orders to 3/12 so the assertions mean
  something; check the run time stays inside the existing 600s.
- Docs: the generation page under `docs/` describing personas, and
  `docs/PROMPT_TEMPLATES.md` for the new prompt. Conductor: this track to
  IN PROGRESS/COMPLETED in `conductor/tracks.md`.
- Frontend only if question 6 changes (`FE/config/generationSections{,.test}.js`).

## Node E2E verification

Phases 2, 4 and 5 touch generator/workflow logic, so run
`bash scripts/run-e2e-ldm.sh -v -k --ci` locally or dispatch
`.github/workflows/e2e-verification.yml` on the branch with no `ai_provider`
(the nightly has no key, so demo mode is the path that must pass). Pass =
the Demo run reaches 100% with no `[ERROR]`, and the Phase 5 read-back passes.
Phase 3's live path is verified by one dispatch with `ai_provider` set, run
manually; it is not a nightly gate.

## Size

Five PRs (six if Phase 3 splits), plus the six issues above.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-11-17_ | _Last Reviewed: 2026-11-17_
