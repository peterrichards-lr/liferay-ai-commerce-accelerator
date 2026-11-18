# Multimodal Seeding Implementation Plan

`MS/` and `FE/` as in the [spec](./spec.md). Each step is one PR and needs its
own issue (description, analysis, plan) before `gh pr create`. Issues are
listed, not filed. Order: evidence first, so later phases have a gate.

## Phase 1: Evidence and cleanup (no behaviour change for users)

- **PR 1: E2E: read the demo products' images back.**
  - Issue: "The nightly attaches images to every demo product and nothing
    checks that it did".
  - Touches `playwright/tests/e2e/dashboard.spec.js` (extend the read-back
    test at `:101`): `GET /o/headless-commerce-admin-catalog/v1.0/products/{id}/images`
    returns at least one item with an `image/*` content type and a `src`.
  - Proves: the existing placeholder path on a real DXP. Baseline for Phase 2.
- **PR 2: Drop the unused `images` and `attachments` from the product prompt.**
  - Issue: "The product prompt asks for image and attachment filenames that
    nothing reads".
  - Touches `MS/prompts/product.md:34-38,55`, `MS/generation-schemas/product.json`,
    `MS/generators/mockDataGenerator.cjs:254-269`, regenerated batch 09 and 18.
  - Tests: `MS/tests/configurationIntegrity.test.cjs` (seed equals prompt),
    a `mockDataGenerator` assertion that products carry no `images` field,
    `promptSchemaTypes.test.cjs`.
  - Blocked on open question 2.
- **PR 3: Docs: say what media actually does.**
  - Issue: "FEATURES.md names DALL-E and Nano Banana; neither is used".
  - Touches `docs/FEATURES.md:30-60`, `docs/deep-dives/microservice-architecture.md`.
  - Test: docs lint and `scripts/check-docs-rendered.sh`.

## Phase 2: Demo mode that looks real

- **PR 4: Generate and commit the demo media pack.**
  - Issue: "Demo mode gives every product the same 112px placeholder".
  - Adds `scripts/build-demo-media-pack.cjs` (one-off, needs an OpenAI key,
    reuses `prompts/image.md` with the brand-free guidance) and its output
    `MS/data/demo-media/<category-slug>.json` (3 WebP images per seeded
    category, `{contentType, base64, title}`), plus a README line in
    `MS/data/README.md`.
  - Tests: new `MS/tests/demoMediaPack.test.cjs`: one file per entry in
    `21-object-entry-ai-categories`, each image decodes, is WebP, under a
    size budget; the asset scan (#1264) and `client-extension.yaml`
    assembly (`data/*.json` must not miss a subdirectory: add
    `data/demo-media/*.json` explicitly).
- **PR 5: Use the pack in demo mode.**
  - Touches `MS/generators/mediaGenerator.cjs` (new `demoImageSet(product)`
    used where `placeholder`/`default`/`ai`+`demoMode` resolve, `:569-584`),
    keyed by category with a deterministic pick from `shareSelection.cjs`;
    falls back to the configured default image for an unknown category.
    Stable ERCs as at `:647`.
  - Tests: `MS/tests/demoMediaImages.test.cjs` (same product gets the same
    images twice; two products in a category differ; unknown category falls
    back; no network call), and `mediaReconcile.test.cjs` still green.
  - Decide in the issue whether `placeholder` keeps meaning "the configured
    default" outside demo mode (recommended: yes).
- **PR 6: E2E: demo images are not the placeholder.**
  - Touches `dashboard.spec.js` (step 1's test): at least two distinct image
    `src`/sizes across the demo products, and size above the placeholder's.
  - CLI parity (#880): `playwright/tests/e2e/cli.spec.js` reads one product's
    images after `aica generate --demo`.

## Phase 3: Better AI images (live mode only)

- **PR 7: Ground the image prompt in the product's copy.**
  - Issue: "The AI product image sees only the product name".
  - Touches `MS/prompts/image.md`, `MS/services/aiService.cjs:1782-1793`
    (pass short description, key specifications, option values), batch 13.
  - Tests: `promptRendering.test.cjs`, `promptContext.test.cjs` (brand guidance
    unchanged), `aiService.test.cjs` (rendered prompt contains description,
    not HTML).
- **PR 8: Compressed output with the true content type, localized titles.**
  - Issue: "AI images are posted as PNG at full size and titled in en_US only".
  - Touches `MS/services/ai-providers/openaiProvider.cjs:315-326` (request
    WebP/JPEG if supported, return `{base64, contentType}`),
    `mediaGenerator.cjs:538-564` (stop hardcoding `image/png`; titles for
    `config.selectedLanguages`).
  - Tests: `MS/tests/aiProviders.test.mjs` (request body, content type),
    `mediaReferences.test.cjs`, `mediaArchive.test.cjs` (extension follows type).
  - Before coding: read Commerce media allowed extensions/max size on the
    pinned DXP and record them in `docs/deep-dives/liferay-api-constraints.md`.

## Phase 4 (optional, gated on open questions 3 and 5)

- **PR 9: AI galleries / option images** (`imageCount`, `options` on the attachment),
  `FE/components/data-generator/VisualAssetControls.jsx` and
  `scripts/aica-cli.cjs` together (#880). Tests: `VisualAssetControls.test.jsx`,
  `mediaOnlyRun.test.cjs` (a product with 1 of 3 is not covered, #851).
- **PR 10: Bounded concurrency for AI images** in `mediaGenerator.cjs:527`, with
  `mediaSubflow.test.cjs` proving order-independent counts.

## Verification on a node E2E run

The nightly has no AI provider, so Phases 1-2 are what it can prove:

- `./scripts/run-e2e-ldm.sh` against the node (or the `e2e-verification`
  workflow, target `nightly`): the demo run, then the read-back asserts images
  exist (step 1), come from the pack and differ (step 6).
- Manual check on the same node: open a demo product on the storefront; the
  gallery shows category pictures, not the Liferay default.
- Phase 3 has no automated live proof. Record one manual live run per PR
  (2 products, `imageMode: ai`) with the archive manifest's content types and
  sizes in the PR body; the live spec (`dashboard.spec.js:159`) runs only
  where `OPENAI_API_KEY` is set.

Size: 8 PRs for Phases 1-3 (steps 1-8), plus 2 optional.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-11-17_ | _Last Reviewed: 2026-11-17_
