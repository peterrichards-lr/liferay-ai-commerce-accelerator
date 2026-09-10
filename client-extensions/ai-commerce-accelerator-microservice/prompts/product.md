Generate realistic product data for {{count}} {{category}} products with multilingual content for these languages: {{languageList}}.

{{brandGuidance}}

You must return a JSON object that conforms to the provided JSON schema: a single "products" property whose value is an array. Each element of that array must be one product object with exactly the following properties:

- name: object of multilingual product names keyed by language code ({{languageCodesCSV}}). Example structure: {{languageCodesNamePairs}}. Values are human-friendly product names.
- description: object of multilingual, detailed marketing descriptions keyed by language code.
- shortDescription: object of multilingual short summaries keyed by language code.
- urls: object of multilingual URL slugs keyed by language code (lowercase, spaces replaced with hyphens) for each language code in {{languageCodesCSV}}.
- baseSku: string base SKU without variant codes, used as the root for all SKUs (for example "PRODUCT-001").
- productType: string, always "simple".
- skus: array of one base SKU object. Each SKU object must have:
  - sku: string (usually baseSku).
  - cost: number.
  - price: number (> 0).
  - inventoryLevel: integer quantity in stock.
  - externalReferenceCode: string. For all SKUs (base and variants), this MUST be the same as the "sku" field.
- specifications: array of 3–5 realistic specification objects. Each spec object must have:
  - specificationKey: string, unique alphanumeric uppercase key for the specification (e.g. "MATERIAL", "WEIGHT", "SCREEN_SIZE").
  - label: object of multilingual specification names keyed by language code (for example "Material", "Weight").
  - value: object of multilingual specification values keyed by language code ({{languageCodesCSV}}).
- options: array of 2–3 product option objects that are contextually appropriate for {{category}} products. Each option object must have:
  - name: string option name (for example "Color", "Size").
  - fieldType: string, one of: "checkbox", "checkbox_multiple", "numeric", "radio", "select", "text". Do NOT use "date" or "select_date".
  - skuContributor: boolean, set to true ONLY for options that define unique physical variants (e.g. Color, Size).
  - productOptionValues: array of string values (for example ["Black", "Silver"]). IMPORTANT: This array must be EMPTY for the "numeric" and "text" field types.
- skuVariants: array of variant SKU objects generated from meaningful combinations of the options. Limit to 8–12 variants per product. Each variant object must have:
  - sku: string composed from baseSku plus variant codes (for example "PRODUCT-001-BLK-L").
  - options: array of {"name", "value"} entries, one per option, where "name" matches an option name from the "options" array above and "value" is the selected value (for example [{"name": "Color", "value": "Black"}, {"name": "Size", "value": "Large"}]). IMPORTANT: You MUST provide an entry for EVERY option defined in the "options" array, even if it is not a skuContributor.
  - priceModifier: number representing percentage adjustment from the base price (for example -0.15 for -15%, 0.2 for +20%). Premium options should cost more.
  - inStock: boolean (for realism, roughly 90% true and 10% false).
    {{priceEntriesInstruction}}
- images: array of 1–3 realistic image metadata objects. Each image object must have:
  - src: string (placeholder filename like "product-main.webp").
  - title: object of multilingual image titles keyed by language code.
  - priority: integer (1 for main image).
- attachments: array of 2–3 realistic document file names (for example "installation-manual.pdf", "warranty-information.pdf").
- active: boolean, whether the product is active.
- metaDescription: object of multilingual SEO descriptions keyed by language code.
- metaKeyword: object of multilingual SEO keyword strings keyed by language code (comma-separated keywords per language).
- metaTitle: object of multilingual SEO titles keyed by language code.
- category: object of multilingual category names keyed by language code (for example {"en_US": "Electronics", "es_ES": "Electrónica"}).
  {{vocabularyGuidance}}

{{currencyGuidance}}

- externalReferenceCode: string unique identifier for the product (for example "PRODUCT-001-1234567890").

IMPORTANT rules:

- For all multilingual fields (name, description, shortDescription, urls, metaDescription, metaKeyword, metaTitle, image title, specification value), create objects where each key is a language code from {{languageCodesCSV}} and each value is the content translated into that language.
- For urls, derive each value from the corresponding name: lowercase, spaces replaced by hyphens, remove characters that are not URL-friendly.
- Do NOT include any properties on the product objects other than:
  name, description, shortDescription, urls, baseSku, productType, skus, specifications, options, skuVariants, images, attachments, metaDescription, metaKeyword, metaTitle, externalReferenceCode, priceEntries, category, active.
- Return the array inside the "products" property of a single top-level object, exactly as the provided JSON schema requires. Do not return a bare array, and do not add any other top-level property.
- Do NOT include explanations, comments, markdown, or backticks. Return raw JSON only.
- SKU Activation: For a SKU to be "Active" in Liferay, it MUST have an assigned value for EVERY option that is defined on the product. Ensure "skuVariants" objects include all options.
- Option Values: Predefined values ("productOptionValues" array) are only for "select", "radio", "checkbox" and "checkbox_multiple". Do not provide them for "numeric" or "text".
- Sizing Options: An option that expresses a size or fit - a helmet shell, a boot or glove size, a jacket chest measurement - MUST use "select" or "radio", even when its values are plain numbers. A size is a choice from a fixed range the product is made in, not a free measurement, and "numeric" cannot carry "productOptionValues", so a numeric size declares no choices, produces no variants, and leaves the product with a single SKU in one unstated size.
- Option Coverage: The values an option declares and the values the variants use MUST be the same set, in BOTH directions. Every value you list in an option's "productOptionValues" MUST be selected by at least one object in "skuVariants", and every value a variant selects MUST already be listed in that option's "productOptionValues". A declared value no variant uses is an empty choice in the storefront; a variant naming an undeclared value is a SKU Liferay marks inactive.
- Option Budget: Choose the number of values so that covering every one of them fits within 8–12 variants. Two options of three values each need only three variants to cover all six values, and nine are available. If you cannot cover every value, declare fewer values — never leave a declared value without a variant.
- Price Coverage: If you return "priceEntries", return exactly one entry per object in "skuVariants" — never one entry for the whole product. When any option has "skuContributor": true, Liferay creates no SKU for "baseSku", so an entry naming it prices a SKU that does not exist, and that entry is discarded along with everything carried on it. Only a product where no option is a skuContributor is priced by a single entry naming "baseSku".
- Price Tiers: When "tierPrices" are asked for, every entry carries its own tiers — they are a property of the product, not of one of its SKUs. Every "externalReferenceCode" must be unique across the whole response, on the entries and on the tiers inside them alike. Liferay resolves a tier by that code alone, so two entries sharing one leave a single tier and report no error.

{{assignedNamesGuidance}}

{{avoidProductsGuidance}}
