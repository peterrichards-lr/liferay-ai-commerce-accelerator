# Multi-Catalog & Multi-Brand Specification

Paths: `MS/` = `client-extensions/ai-commerce-accelerator-microservice/`,
`FE/` = `client-extensions/ai-commerce-accelerator-frontend/`. Line numbers
are as of `master` on 2026-11-17. **(inferred)** marks what was reasoned from
code, not observed on an instance.

## 1. Goal

One operator action produces two or more brands on one instance - each with
its own catalog, price lists, channel(s) and brand-voiced data - and each brand
can be re-run, exported and torn down without touching the others. It must work
in demo mode, so the nightly node E2E can prove it.

## 2. What exists today

**One run = one catalog + one primary channel.** `catalogId`/`channelId` are
resolved per run and stale ids refused (`MS/utils/commerceSelection.cjs:381`,
called from `MS/routes/generate.cjs:108`, `routes/import.cjs:44`,
`routes/export.cjs:518`). CLI: `--catalog-id`, `--channel-id`
(`scripts/aica-cli.cjs:243-267`); UI: one catalog and one channel `ClaySelect`
(`FE/src/components/config/CommerceCard.jsx:191`).

**One product set across several channels (#664)** - built, CLI-only.
`resolveRunChannelIds` (`MS/utils/runChannels.cjs:22`) feeds
`productChannels` (`MS/generators/product-steps/products.cjs:130`) and the
warehouse links (`MS/generators/warehouseGenerator.cjs:136`);
`channelBackfillSteps` (`runChannels.cjs:43`) attaches a later orders-only run's
channels to an earlier run's products (`products.cjs:445`, union PATCH). Stale
`channelIds` are dropped, not refused (`commerceSelection.cjs:292`). Exposed as
`--channel-ids` (`aica-cli.cjs:489`); the frontend never sends `channelIds`.

**Creating catalogs and channels (#746)**: `POST /create-catalog` and
`/create-channel` (`MS/routes/get.cjs:264`, `:319`) require name and currency;
the channel route applies a site type through the `commerce-site-type` OSGi
module (`get.cjs:370`, `MS/services/commerceSiteTypeService.cjs:143`), the only
write path, since headless has none (#622 / LPD-105691). Neither carries an
ERC, so neither is AICA-owned, and no delete step removes catalogs or channels.

**Price lists are already per catalog.** ERC `[purpose, catalogId, sessionId]`,
name `AICA - <purpose> (<catalogId>)` (`MS/generators/product-steps/pricing.cjs:577-660`);
stale lists are only swept within the same catalog. The base flag cannot be
written (#943 / LPD-105688); `setCatalogBaseFlag` reads it back and warns
(`MS/utils/catalogBaseFlag.cjs:19`, `pricing.cjs:135-205`).

**Brand is one free-text field per run.** `brandName` (`MS/utils/normalize.cjs:297`;
UI `FE/src/components/data-generator/DataGeneratorForm.jsx:411-429`) becomes
`{{brandGuidance}}` in every prompt (`MS/prompts/product.md:3`,
`MS/utils/promptContext.cjs:34`, `MS/services/aiService.cjs:772`). **Demo mode
ignores it**: the mock BRAND specification is hard-coded `'AICA Elite'`
(`MS/generators/mockDataGenerator.cjs:330`).

**Other relevant pieces.** `catalogExpiry` (`MS/utils/catalogExpiry.cjs:70`) and
`categoryTree` (`MS/utils/categoryTree.cjs:34`) are config-wide, not per
catalog; taxonomy goes into the channel's site vocabulary
(`MS/generators/product-steps/categories.cjs:79-120`). Ownership is ERC-prefix
based (`MS/utils/ownershipScope.cjs:39-60`). Export is one session
(`MS/routes/export.cjs:37`), and import already targets whatever catalog the
request names, so a dataset can be replayed into a second catalog today.

## 3. What is missing or wrong for two catalogs

1. **Demo promotions collide across catalogs.** Demo segment and promotion
   ERCs are catalog-agnostic (`mockDataGenerator.cjs:718`, `:729`);
   `PromoGenerator` reuses any price list found by that ERC
   (`MS/generators/PromoGenerator.cjs:305`) without checking its `catalogId`,
   so brand B's promo entries go into brand A's promotion list. Whether Liferay
   rejects a cross-catalog entry or accepts it is **(inferred: unknown)**.
2. **Selected delete is not catalog-scoped for shared entity types.** Discovery
   crawls accounts, account groups and warehouses company-wide
   (`MS/services/deleteCoordinatorService.cjs:255`, `:263`, `:382`) and options
   and specifications by product but without checking other catalogs' use
   (`:354`, `:367`). Deleting brand B by catalog would remove brand A's
   accounts, segments and warehouses. Accounts are not channel-linked by AICA
   (#610), so no Liferay relation can scope them.
3. **Warehouse reuse is instance-wide** (`warehouseGenerator.cjs:202`, default
   on, `normalize.cjs:342`): brand B adopts brand A's warehouses **and every
   non-AICA one**, then links them to channel B.
4. **No brand plan.** Nothing runs N brands in sequence, creates their
   catalog/channel idempotently, or gives each its own brand context.
5. **Demo output is indistinguishable between brands** (item 'AICA Elite').
6. **The UI cannot set extra channels** (`channelIds`) or run several brands.

## 4. Scope

- Correctness first: two catalogs on one instance can be generated, re-run
  and selectively deleted independently (items 1-3).
- A **brand plan**: a JSON list of brands, each naming or creating a catalog
  and channel(s), with its own `brandName`, site type and counts, executed as
  **one ordinary session per brand, in sequence**. No new session type.
- Idempotent find-or-create of brand catalogs and channels by AICA ERC.
- Demo mode carries the brand into names and the BRAND specification.
- CLI first (`aica generate --brands <file>`); UI gets `channelIds` and a
  brand selector, not a plan editor.
- Node E2E proof in demo mode.

## 5. Non-goals

- Setting a catalog's base price list (blocked by #943) or relying on site
  type where the OSGi module is absent (#622); both stay best-effort + warned.
- A multi-catalog export bundle format; export stays per session.
- Cross-brand shared account/customer models, channel-account assignment
  (#610), per-brand themes/storefront pages/site creation.
- Deleting catalogs, channels or sites in default `delete` runs.
- Parallel brand runs.

## 6. Constraints

- **Demo mode without an AI provider** must produce two visibly distinct brands
  end to end; the nightly has no provider.
- **Teardown stays correct and scoped.** `delete --all` still removes every
  AICA-owned entity in every catalog and releases price-list locks (E2E
  `playwright/tests/e2e/teardown-locks.spec.js`). Selected delete of brand B
  must leave every brand A entity in place. Ownership remains the frozen
  `ownershipScope` objects (#850); no new widening path.
- **Idempotent re-runs**: a second run of the same plan without a delete must
  not fail (cf. #1455's 409 on promo-segment link). Stable ERCs that become
  catalog-scoped must still be found-and-reused, not recreated.
- **Stale ids refused, never substituted** (#680, #889) - also for plan entries.
- **Single-catalog runs unchanged**: same payloads, same ERCs where possible.
- Shared OSGi modules may not resolve on Q3.0 (boot log decides), so the site
  type write must degrade to a warning.

## 7. Open questions (with recommendations)

1. **Sequence of runs or one multi-catalog session?** Recommend a sequence:
   session = one catalog keeps resume, export, progress and selected delete
   semantics intact.
2. **Should brand segments (account groups) be shared or per brand?**
   Recommend per catalog: key segment and promotion ERCs on `catalogId`; a
   shared segment couples teardown.
3. **How is selected delete scoped for accounts/warehouses?** Recommend from
   AICA's own records: entities created by sessions whose `config.catalogId`
   matches, plus a "still referenced by another catalog/channel" keep-rule for
   options, specs and warehouses. Not a new ERC prefix scheme.
4. **Should `delete --all` remove AICA-created brand catalogs/channels?**
   Recommend no by default; add `--include-brand-containers` later if asked.
5. **Warehouse reuse across brands?** Recommend reuse only warehouses already
   linked to the run's channels (plus AICA-owned unlinked ones) when a plan
   runs; leave single-run default untouched.
6. **Brand plan in the UI?** Recommend CLI only for this track; UI after
   demand is shown.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-11-17_ | _Last Reviewed: 2026-11-17_
