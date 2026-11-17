# Multi-Catalog & Multi-Brand Implementation Plan

`MS/`, `FE/` as in the [spec](./spec.md). Unit tests: `MS/tests/*.test.cjs`;
frontend tests are colocated `FE/src/**/*.test.js(x)` (no `FE/tests/`). One
step = one PR, each behind an issue listed at the end (none filed).

## Phase 0: Establish the platform facts (no product code)

1. **Probe on a node (pinned DXP), answers on issue A:** (a) is a catalog-B SKU
   price entry accepted in a catalog-A promotion list? (b) does deleting an
   option/spec still used by another catalog fail or unlink? (c) is a taxonomy
   category ERC unique per site or per company? (d) does `commerce-site-type`
   resolve? These set the severity of 1.1 and 1.3. No repo changes.

## Phase 1: Two catalogs on one instance are independent

1. **Catalog-scope demo segments and promotions.** Add `catalogId` to the ERC
   parts at `mockDataGenerator.cjs:718` and `:729`, and make `PromoGenerator`
   (`:305`) refuse to reuse a found list whose `catalogId` differs, saying so.
   Tests: `MS/tests/PromoGenerator.test.cjs` (a found list from another catalog
   is not reused, a same-catalog list still is, and a 409 on the link is still
   tolerated per #1455); `MS/tests/mockMatchesGenerationSchemas.test.cjs` still
   passes.
2. **Session-attributed delete scope.** New `MS/utils/catalogDeleteScope.cjs`
   collects the account, account-group and warehouse ERCs created by persisted
   generation sessions for a `catalogId`. `deleteCoordinatorService.cjs`
   DISCOVER (`:255`, `:263`, `:382`) intersects with that set when the run is
   SELECTED. `isTotal` and `ownershipScope` are unchanged. Tests: new
   `MS/tests/catalogDeleteScope.test.cjs`, plus extended
   `MS/tests/deleteCoordinatorService.test.cjs` and
   `MS/tests/deleteRoutes.test.cjs` (selected delete of B keeps A's accounts,
   groups and warehouses; total delete still takes both).
3. **Keep shared definitions in use.** In the relational crawl (`:354`, `:367`),
   options and specifications still referenced by a product outside the
   targeted catalog are kept, and warehouses linked to another channel are
   unlinked rather than deleted. Tests: `deleteCoordinatorService.test.cjs`
   with MSW handlers in `MS/tests/mocks/handlers.mjs`.
4. **Plan-aware warehouse reuse.** Add an opt-in `reuseWarehousesFrom:
'run-channels'` that adopts only warehouses linked to the run's channels
   (`warehouseGenerator.cjs:202`). The single-run default stays as it is.
   Tests: `MS/tests/warehouseReuse.test.cjs`.
5. **E2E: two demo catalogs.** New `playwright/tests/e2e/multi-catalog.spec.js`
   with five steps. (1) Create catalog B and channel B through `/create-catalog`
   and `/create-channel`. (2) Run `aica generate --demo` into A and into B.
   (3) Run B again without a delete, which must succeed. (4) Run
   `aica delete --selected --catalog-id B` and read A back over headless:
   products, price lists, promotions, accounts and warehouses are still there.
   (5) Run `delete --all` and assert no `AICA-` price lists are left (the
   teardown-locks poll). Check that `MS/tests/e2eShardPlan.test.cjs` and
   `MS/tests/e2eSpecsAuthenticate.test.cjs` still pass.

## Phase 2: Brand plan

1. **Brand plan schema.** New `MS/utils/brandPlan.cjs`: normalise and validate
   `[{ key, brandName, catalog: {id} | {name, currencyCode, defaultLanguageId},
channels: [{id} | {name, currencyCode, siteGroupId, siteType}], counts }]`.
   Unknown keys and duplicate `key`s are rejected. Tests: new
   `MS/tests/brandPlan.test.cjs`.
2. **Idempotent find-or-create.** `/create-catalog` and `/create-channel`
   (`MS/routes/get.cjs:264`, `:319`) accept an optional ERC
   `AICA-BRAND-<key>-CATALOG` / `-CHANNEL-<n>` and return the existing entity
   on a match. A stale `{id}` is refused, as `commerceSelection` does. The
   prefix must not start with `AICA-CAT`, which taxonomy categories use. Tests:
   `MS/tests/createCatalogAndChannel.test.cjs`,
   `MS/tests/createChannelDefaults.test.cjs`, `MS/tests/ownershipScope.test.cjs`
   (no delete crawl picks these up).
3. **CLI `aica generate --brands <file>`.** `scripts/aica-cli.cjs` runs one
   ordinary session per brand in sequence and stops at the first failure,
   naming the brand. A missing site-type module is a warning. It ends with a
   per-brand summary: catalog, channel(s), session id, and a base-list warning
   (#943). Tests: `MS/tests/cliParseGenerateArgs.test.cjs`,
   `MS/tests/cliOptionCoverage.test.cjs`, and a new
   `MS/tests/cliBrandPlan.test.cjs` with a stubbed `nativePost`.
4. **Brand in demo data.** `mockDataGenerator.cjs` uses `brandName` for the
   BRAND specification (`:330`) and as a name prefix, so demo brands differ.
   Tests: `MS/tests/mockMatchesGenerationSchemas.test.cjs` and a new case in
   `MS/tests/generatorParity.test.cjs`.
5. **E2E: plan run.** Extend `multi-catalog.spec.js` to run a two-brand plan
   with `--demo` twice, the second time with no delete. Read both catalogs back
   and assert distinct BRAND values and per-catalog `AICA - ... (<id>)` price
   lists.

## Phase 3: Frontend

1. **Extra channels in the UI.** Add a multi-select for `channelIds` in
   `FE/src/components/config/CommerceCard.jsx` and send it from `App.jsx`.
   Tests: `FE/src/components/config/CommerceCard.test.jsx` and
   `FE/src/App.buildPayload.test.jsx`.
2. **Scoped delete preview.** The selected-delete dialog shows what will be
   kept because another catalog uses it. Tests:
   `FE/src/components/dashboard/Dashboard.test.jsx`.

## Phase 4: Documentation

1. A `docs/` page covering two brands on one instance: plan file, CLI, site
   type caveat, #943, and delete semantics. Update `conductor/tracks.md` status
   and footers. Proved by the docs CI (`check-docs-links`, rendered check).

## Verification on a node E2E run

No AI provider on the nightly, so all of it runs `--demo` on the node shard
(`e2e-verification.yml`, one shard per remote target, #1079). Green means: both
catalogs populated; a second run passes with no delete; a selected delete of B
leaves A intact; `delete --all` clears both with teardown-locks still green; the
log names each catalog and shows #943 once per catalog as a warning only.

## Issues to file (not filed)

- A: Probe the cross-catalog platform behaviour (Phase 0).
- B: Demo segment and promotion ERCs collide across catalogs (1.1).
- C: Selected delete removes other catalogs' accounts, groups and warehouses
  (1.2, 1.3).
- D: Warehouse reuse adopts every instance warehouse (1.4).
- E: E2E for two catalogs on one instance (1.5).
- F: Brand plan schema and idempotent brand catalog/channel (2.1, 2.2).
- G: `aica generate --brands` and brand-aware demo data (2.3, 2.4, 2.5).
- H: `channelIds` and the scoped-delete preview in the UI (3.1, 3.2).

Rough size: 13 PRs (Phase 0 is not a PR), docs included.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-11-17_ | _Last Reviewed: 2026-11-17_
