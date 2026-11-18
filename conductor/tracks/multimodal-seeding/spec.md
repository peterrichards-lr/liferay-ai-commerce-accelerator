# Multimodal Seeding Specification

Paths are abbreviated: `MS/` is `client-extensions/ai-commerce-accelerator-microservice/`,
`FE/` is `client-extensions/ai-commerce-accelerator-frontend/src/`, `SDK/` is
`node_modules/@liferay/accelerator-sdk/src/` (v0.12.8). Line numbers are from
`bdc5727a`. **[inferred]** marks something not read in this tree.

## 1. Goal

A generated catalogue should look like a real shop: each product carries
pictures that fit its name, category and copy. This must hold **in demo mode
too**, because demo mode has no AI provider and it is what the nightly E2E runs
and what most first-time users see.

## 2. What already exists

The media pipeline is largely built. It shipped issue by issue, not as a track.

| Capability                                                                    | Evidence                                                                                                                      | Tested                                                           |
| :---------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- |
| Image modes `none/placeholder/default/ai/picsum/custom/bundle`                | `MS/utils/schemas.cjs:31`; branches at `MS/generators/mediaGenerator.cjs:538-610`                                             | `mediaOnlyRun`, `mediaBundleAttach`                              |
| AI images via OpenAI `gpt-image-2`, base64, min 1024px                        | `MS/services/ai-providers/openaiProvider.cjs:42,68,301-327`                                                                   | `MS/tests/aiProviders.test.mjs:155-190`                          |
| Editable image prompt with brand/no-trademark guidance (#641, #650)           | `MS/prompts/image.md`; `MS/services/aiService.cjs:1747-1800`; batch `13-object-entry-ai-prompt-image`                         | `promptContext.test.cjs`                                         |
| Media-provider capability guard (Claude, Gemini, Nano Banana cannot draw)     | `MS/utils/providerCapabilities.cjs:62-79`; `MS/utils/providerRegistry.cjs:229`; Gemini throws at `geminiProvider.cjs:140-145` | `providerCapabilities.test.cjs`                                  |
| Product PDFs (AI or placeholder, four content types)                          | `mediaGenerator.cjs:734+`; `MS/prompts/pdf.md`                                                                                | `mediaOnlyRun.test.cjs`                                          |
| Media steps run after orders; failure is BYPASSED, not fatal (#673)           | `MS/generators/product-steps/media.cjs:81-160`                                                                                | `mediaSubflow.test.cjs`                                          |
| Idempotent attach: stable ERC + read-before-post (#1040)                      | `mediaGenerator.cjs:39-63,647-660`                                                                                            | `mediaReconcile.test.cjs`                                        |
| `neverExpire` on upload (#853)                                                | `mediaGenerator.cjs:673`                                                                                                      | `mediaReferences.test.cjs`                                       |
| Disk archive before upload, retention configurable (#848, #898, #917)         | `MS/utils/mediaArchive.cjs`, `mediaArchiveConfig.cjs`                                                                         | 5 `mediaArchive*` suites                                         |
| `.aicap` export/import and extract carry media (#814, #849, #852, #877, #878) | `MS/utils/mediaBundle.cjs`, `mediaExtractor.cjs`, `instanceExtractor.cjs:421`                                                 | `mediaBundle*`, `mediaExtractorResume`                           |
| Media-only run for products missing media ("Media" button, #676, #851, #875)  | `FE/hooks/useMediaGeneration.js:40`; `FE/components/ui/MediaGenerationModal.jsx`; `MS/utils/mediaScope.cjs`                   | `useMediaGeneration.test.js`, `mediaOnlyRun.test.cjs` (28 cases) |
| CLI `--images <mode>` (#735, #736)                                            | `scripts/aica-cli.cjs:189-196`                                                                                                | `cli.spec.js` (no media assertion)                               |
| Per-route body ceilings after the 413 (#887)                                  | `MS/utils/constants.cjs:212-213` (10 MB general, 256 MB import); `MS/server.cjs:293,310`                                      | yes                                                              |

So "add media to generated products" is **done**. What follows is what is not.

## 3. What is missing

1. **Demo-mode images look fake.** In demo mode every product gets the same
   seeded placeholder: a 112x112 WebP labelled "Liferay Product Default"
   (`03-object-entry...json`, key `DEFAULT-IMAGE`; fallback
   `MS/data/mock-image.json`). An `ai` request in demo mode is downgraded to it
   (`mediaGenerator.cjs:569-584`, `FE/hooks/useGeneration.js:84-90`). The UI
   offers only None/Placeholder/AI Gen (`FE/components/data-generator/VisualAssetControls.jsx:79-89`);
   `picsum` exists in the backend but pulls random, unrelated photos.
2. **The AI image ignores the product's copy.** `prompts/image.md` receives
   only name, style, brand and category (`aiService.cjs:1782-1793`). The PDF
   prompt gets description and specifications; the image prompt does not, nor
   the option values (colour, material) that define variants.
3. **One AI image per product.** The AI branch builds a single-item set
   (`mediaGenerator.cjs:538-564`); picsum builds three. No gallery and no
   option-specific (SKU) images. Liferay's product attachment carries an
   `options` map for that **[inferred, verify on the pinned DXP]**.
4. **Dead fields in the product prompt.** `MS/prompts/product.md:34-38` asks the
   model for 1-3 `images` and 2-3 `attachments` filenames; the schema accepts
   them (`MS/generation-schemas/product.json:47-73`) and the mock writes them
   (`MS/generators/mockDataGenerator.cjs:254-269`). Nothing reads them
   (grep: no consumer of `productData.images` or `.attachments`). They cost
   output tokens on every product.
5. **Heavy payloads.** The AI image arrives as PNG and is posted as
   `image/png` regardless (`mediaGenerator.cjs:560`). At 1024x1024 that is
   roughly 1.5-3 MB per image **[inferred]**, base64-inflated by a third, and
   the same bytes go into the archive and every `.aicap`.
6. **Images are uploaded one product at a time** (`mediaGenerator.cjs:527`),
   so AI image latency adds up linearly with catalogue size.
7. **No end-to-end evidence.** No Playwright spec reads a product's images
   back. The demo read-back test (`playwright/tests/e2e/dashboard.spec.js:101`)
   checks copy and SEO only; the live test (`:159`) is skipped without a key.
8. **Titles are `en_US` only** in the AI and placeholder paths
   (`mediaGenerator.cjs:550-580`); other selected languages get no image title.
9. **Stale docs.** `docs/FEATURES.md:32,60` still say "DALL-E or Nano Banana".

## 4. Scope

- A demo-mode image source that gives products category-appropriate, varied
  pictures with no provider and no network (gap 1).
- Image read-back in the nightly E2E (gap 7).
- Richer AI image prompt from the product's own copy and options (gap 2).
- Remove the dead `images`/`attachments` prompt fields, or use them (gap 4).
- Compressed output format with the real content type (gap 5).
- Localized image titles (gap 8) and corrected docs (gap 9).
- Optional, behind a decision: galleries and option-specific images (gap 3),
  bounded concurrency (gap 6).

## 5. Non-goals

- Video, 3D, audio or other new media kinds. PDFs stay as they are.
- A Gemini/Imagen or Nano Banana image adapter, or a selectable image model
  (`scripts/refresh_ai_models.py:69` "no image-model setting yet"; seed drift is
  #1469, tracked separately).
- Sourcing photos from stock APIs or the web: licensing and trademark risk (#641).
- Category or brand imagery beyond products (banners, site pages).
- Changing the `.aicap` format or archive layout.

## 6. Constraints

- **Demo mode works with no AI provider and no outbound network.** The nightly
  node has neither key; any demo image source must ship inside the client
  extension. `MS/client-extension.yaml` assembles `data/*.json` only (#1131),
  so new assets either live as JSON in `data/` or need an explicit include.
- **Cost and latency.** Media is the most expensive part of a run (#673) and
  already needs explicit consent (`confirmMediaGeneration`,
  `useMediaGeneration.js`). Every extra AI image multiplies spend; a gallery of
  3 triples it. gpt-image latency is tens of seconds per call **[inferred]**.
- **Liferay upload path.** Images go through
  `POST .../products/by-externalReferenceCode/{erc}/images/by-base64`
  (`SDK/liferay/rest/MultipartService.cjs:498`) as JSON. Allowed image
  extensions and max size are governed by Commerce media configuration
  **[inferred, read the values on the pinned DXP before Phase 3]**. WebP is
  accepted when labelled correctly (#928).
- **Request ceilings.** AICA's own: 10 MB per `/api/v1` request, 256 MB per
  import, 25 MB JSON (`constants.cjs:212-213`, `server.cjs:293`). A `.aicap`
  of 22 products with one image and PDF each was 30 MB (#887); PNG galleries
  would push a 100-product package past 256 MB **[inferred]**.
- **Idempotency.** New images must use the stable-ERC scheme
  (`mediaGenerator.cjs:647`) so retries do not duplicate (#1040).
- **Trademark safety.** Prompt changes keep the brand guidance (#641).
- **Prompt and schema seeds.** Editing `prompts/*.md` or `generation-schemas/`
  means regenerating batch files 09/13/18 with `./gradlew generateBatchFiles`;
  `configurationIntegrity.test.cjs` checks prompts verbatim.

## 7. Open questions

1. **What should demo mode attach?** Recommend a small committed _demo media
   pack_: 3 images for each of the 10 seeded categories (`21-object-entry-ai-categories`),
   generated once with gpt-image-2 under the brand-free prompt, stored as
   512px WebP in `MS/data/demo-media/*.json` (about 1.5 MB total
   **[inferred]**), picked deterministically per product ERC. Alternatives:
   expose picsum (network, unrelated photos) or render images in code (looks
   synthetic).
2. **Keep or drop the product prompt's `images`/`attachments` fields?**
   Recommend drop: removes tokens and a misleading schema. If galleries ship,
   ask for a shot list then, not filenames.
3. **Galleries and option images in AI mode?** Recommend defer: triples cost;
   do them only after the demo pack proves the shape. Demo pack gives a
   3-image gallery for free.
4. **Output format for AI images?** Recommend WebP (or JPEG) with compression
   if gpt-image-2 supports `output_format` **[inferred]**, else convert is a
   non-goal and we accept PNG.
5. **Concurrency for AI images?** Recommend a small fixed limit (2-3) through
   the existing queue settings, only if a timed live run shows it matters.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-11-17_ | _Last Reviewed: 2026-11-17_
