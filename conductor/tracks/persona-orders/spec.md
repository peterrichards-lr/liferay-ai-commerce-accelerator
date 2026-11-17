# Persona Orders Specification

`MS/` is `client-extensions/ai-commerce-accelerator-microservice/`; `FE/` is
`client-extensions/ai-commerce-accelerator-frontend/src/`. Line numbers are as
of `bdc5727a`. Anything marked _(inferred)_ was reasoned from code, not run.

## 1. Goal

A generated order history should read like a customer base: each account
behaves as a recognisable persona (a contractor reordering the same consumables
monthly, a project buyer placing a few large multi-line orders, a one-off
consumer), so order dates, frequency, basket size, quantities and status line
up per account. The same must hold in demo mode, which is what the nightly E2E
and any keyless install run.

## 2. What exists today

- **Demo orders are round-robin, one line each.** `MS/generators/mockDataGenerator.cjs:554-601`:
  account `i % n`, product `i % n`, the product's first SKU, one item of 1-5,
  a uniformly random date in `orderDateRangeDays` (default 30).
- **Live orders are delegated to the model, per chunk.** `MS/services/aiService.cjs:1460-1538`
  chunks by `chunkSizes.order` (default 10); each chunk is an independent call.
  The prompt sees only the first 10 products and 10 accounts (`:1541-1553`), so
  in a 50-account run only 10 accounts can be named _(inferred: unnamed ids fall
  to a random pick, below)_. Product entries pass `sku: p.sku`, which the
  Liferay product shape likely lacks _(inferred)_.
- **The prompt asks for "realistic purchasing patterns"** and nothing more:
  `MS/prompts/order.md:10-18`. Schema `MS/generation-schemas/order.json:8-48`
  carries `accountId`, `items[{sku, quantity}]`, `orderStatus`, `orderDate`.
- **The payload builder re-randomises what the model chose.**
  `MS/generators/orderGenerator.cjs:465-557`: an unmatched SKU falls back to
  `allPurchasableSkus[i % n]` (`:527-535`), a missing quantity to 1-3 (`:540`),
  an unmatched account to a random one (`pickAccount`, `:639-653`).
- **Status is shuffled independently of date.** `orderGenerator.cjs:318-354`
  applies `orderDistribution` then Fisher-Yates shuffles, so a 2-year-old order
  can be "open" and yesterday's "completed".
- **Account type is already modelled.** `MS/utils/accountTypes.cjs:21-95`
  (`business`/`person` are customers; guest/supplier never get orders) and
  `eligibleOrderAccounts` filters existing accounts (`orderGenerator.cjs:837-872`).
  Accounts AICA just created are used as-is (`:813-821`).
- **Channel site type gates account types.** `MS/utils/channelSiteType.cjs:1-17,57-60,228-245`:
  B2C accepts `person`, B2B `business`, B2X both; an unset channel is
  effectively B2C; `evaluateGenerationRun` judges `accountType` and
  `orderAccountType`.
- **"Segments" exist only as promotion targets.** `MS/generators/PromoGenerator.cjs:179-244`
  creates account groups from model-named segments, then assigns the **same
  first two accounts** to every group (`:223`). Demo segments are fixed
  ("Frequent Buyers", "Volume Contractors", `mockDataGenerator.cjs:707-722`).
  Promotions run before orders (`MS/routes/generate.cjs:484-507`), but nothing
  connects a segment to how an account orders.
- **A deterministic selection primitive exists.** `MS/utils/shareSelection.cjs:32-56,157`
  (FNV-1a `hash32`, keyed shares, "same inputs give the same dataset", #729).
- **Invariants:** `MS/utils/orderableSkus.cjs:64-122` (#747/#810),
  `MS/utils/orderErc.cjs:18-49`, `MS/utils/schemas.cjs:157,182-190` (range 0-1095).
- **Frontend knobs:** `FE/App.jsx:54-58`, `FE/config/generationSections.js:49-55,82`.
- **History:** #474 added `accountType` and `orderDateRangeDays` and named
  "reorder frequency, dealer lifecycle" as the aim; #696 made the options reach
  the generator; #585 chunked orders. No issue mentions personas (searched
  `persona`, `orders`, `order history`, `segment`).

## 3. What is missing

1. No notion of an account's buying behaviour anywhere in data or code.
2. No cross-chunk coherence in live mode: each chunk re-decides who buys what.
3. No per-account cadence, basket-size, quantity or product-affinity model.
4. Status is not correlated with recency.
5. Nothing in Liferay shows the persona, so the story is invisible to a viewer.
6. Nothing reads generated orders back to check any of it (E2E reads products only).

## 4. Scope

- A **persona catalogue** in code: a small fixed set per account type (B2B:
  e.g. contract reorderer, project buyer, occasional trade; B2C: e.g. loyal
  regular, seasonal, one-off), each with weight, cadence, lines per order,
  quantity range and SKU-affinity width.
- A **deterministic order planner** (`MS/utils/orderPlan.cjs`, new): assigns
  personas by `hash32(accountERC)`, splits `orderCount` across accounts by
  persona weight, places dates on each persona's cadence inside
  `orderDateRangeDays`, picks lines from an account's favourite subset of the
  orderable SKUs, and assigns `orderDistribution` statuses oldest-completed,
  newest-open.
- **Demo mode** builds orders from the planner alone.
- **Live mode** asks the model only to choose a persona per account (from the
  catalogue, with a short rationale), in chunks; the planner expands it. The
  per-order AI call goes.
- **Persona made visible**: one account group per persona in use, accounts
  assigned to it; PromoGenerator's segment assignment stops using `slice(0, 2)`.
- An E2E read-back of orders, and docs.

## 5. Non-goals

- Users, buyer roles, carts, wish lists, returns, subscriptions, or per-user
  ordering inside a B2B account.
- Real checkout (payments, shipping, tax, inventory decrement). Orders stay
  admin-API created as today.
- Changing the import path (`orderGenerator.cjs:127-214`): imported orders keep
  their own accounts and dates.
- Analytics Cloud events or Commerce analytics dashboards.
- Operator-editable persona definitions (catalogue is code in this track).

## 6. Constraints

- **Demo mode without a provider.** Everything must work through
  `MockDataGenerator`; the facade routes there on `demoMode`
  (`MS/services/generationFacade.cjs:111-112`). The nightly
  (`.github/workflows/e2e-verification.yml`, cron 02:00) has no AI key unless
  dispatched with `ai_provider`.
- **Prompt/schema coupling.** A new or edited `MS/prompts/*.md` or
  `MS/generation-schemas/*.json` must be followed by `./gradlew generateBatchFiles`
  (regenerates the `ai-schema-*`/`ai-prompt-*` object entries in
  `client-extensions/ai-commerce-accelerator-batch/batch/`) and
  `UPDATE_PROMPT_CORPUS=1 yarn test promptRendering`. Adding an entity renumbers
  every generated batch file after it (`build.gradle:458`, `fileIndex++`
  over sorted names): a large, mechanical diff. `03-object-entry` is
  hand-maintained. Mock output must still match the schema
  (`MS/tests/mockMatchesGenerationSchemas.test.cjs`). Prompts edited in the
  Configuration UI override the files.
- **Channel site type.** B2B personas only for `business`, B2C only for
  `person`; an account with no reported type gets a type-neutral persona. The
  planner must not create a mismatch `evaluateGenerationRun` would block.
- **Only orderable SKUs.** Affinity draws from `orderableSkus(...)` honouring
  `generateSkuVariants` (#747, #810); never from product data directly.
- **Determinism.** Same accounts, SKUs, count and range give the same plan
  (#729 rule); no seeded RNG with state; dates relative to a single `now`.
- **Count fidelity.** Exactly `orderCount` orders; shortfall reporting via
  `completeGenerationStep` stays.
- **Liferay:** `orderDate` and `orderStatus` are settable on create (already
  sent, `orderGenerator.cjs:546-556`). Whether the admin API checks inventory
  for large B2B quantities is unverified _(inferred: it does not)_.
- **Scale:** up to 50,000 orders / 5,000 accounts (`MS/services/configService.cjs:490-512`);
  the planner is pure in-memory work, the persona call is chunked.

## 7. Open questions (recommendation in bold)

1. **Replace random ordering outright, or add a toggle?** **Replace.** The
   random shape has no demo value; a toggle doubles the test surface.
2. **What does the model decide in live mode?** **Persona choice per account
   only**, planner does the rest. Alternative: model writes orders against a
   planned skeleton - costlier, reintroduces chunk drift.
3. **New `persona` entity, or repurpose `order.md`/`order.json`?** **New
   entity**, accepting the batch-file renumbering; retire `order.md` in the
   same PR so no dead prompt is seeded.
4. **How is the persona shown in Liferay?** **Account groups** (`AICA-SEG`
   ERC per persona; delete discovery already covers account groups,
   `MS/services/deleteCoordinatorService.cjs:263-264`). Alternatives: account `description` (only for accounts AICA
   creates) or nothing.
5. **Should promotion segments become the persona groups?** **Not in this
   track**; only fix the `slice(0, 2)` assignment to use persona membership.
6. **Expose persona knobs (mix, cadence) in the form?** **No** for the first
   cut; `orderDateRangeDays` and `orderDistribution` remain the knobs.
7. **Existing accounts on standalone runs: assign personas to them?** **Yes**,
   by the same hash; groups only for AICA-owned accounts.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-11-17_ | _Last Reviewed: 2026-11-17_
