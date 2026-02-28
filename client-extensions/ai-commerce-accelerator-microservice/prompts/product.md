Generate realistic product data for {{count}} {{category}} products with multilingual content for these languages: {{languageList}}.

You must return a JSON array that conforms to the provided JSON schema. Each element in the array must be one product object with exactly the following properties:

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
  - published: boolean.
  - purchasable: boolean.
  - neverExpire: boolean.
  - externalReferenceCode: string. For all SKUs (base and variants), this MUST be the same as the "sku" field.
- specifications: array of 3–5 realistic specification objects. Each spec object must have:
  - key: string specification name (for example "Material", "Weight").
  - value: object of multilingual specification values keyed by language code ({{languageCodesCSV}}).
- options: array of 2–3 product option objects that are contextually appropriate for {{category}} products. Each option object must have:
  - name: string option name (for example "Color", "Size").
  - fieldType: string, one of: "checkbox", "checkbox_multiple", "date", "numeric", "radio", "select", "select_date", "text".
  - skuContributor: boolean, set to true ONLY for options that define unique physical variants (e.g. Color, Size).
  - values: array of string values (for example ["Black", "Silver"]). IMPORTANT: This array must be EMPTY for "numeric", "text", and "date" field types. For "select_date", values should be date strings (e.g. "2026-05-01").
- skuVariants: array of variant SKU objects generated from meaningful combinations of the options. Limit to 8–12 variants per product. Each variant object must have:
  - sku: string composed from baseSku plus variant codes (for example "PRODUCT-001-BLK-L").
  - options: object mapping option names to selected values (for example {"color": "Black", "size": "Large"}). IMPORTANT: You MUST provide a value for EVERY option defined in the "options" array, even if it is not a skuContributor.
  - priceModifier: number representing percentage adjustment from the base price (for example -0.15 for -15%, 0.2 for +20%). Premium options should cost more.
  - inStock: boolean (for realism, roughly 90% true and 10% false).
    {{priceEntriesInstruction}}
- images: array of 1–3 realistic image metadata objects. Each image object must have:
  - src: string (placeholder filename like "product-main.webp").
  - title: object of multilingual image titles keyed by language code.
  - priority: integer (1 for main image).
- attachments: array of 2–3 realistic document file names (for example "installation-manual.pdf", "warranty-information.pdf").
- active: boolean, whether the product is active.
- allowBackOrder: boolean, whether backorders are allowed for this product.
- metaDescription: object of multilingual SEO descriptions keyed by language code.
- metaKeyword: object of multilingual SEO keyword strings keyed by language code (comma-separated keywords per language).
- metaTitle: object of multilingual SEO titles keyed by language code.
- category: string, the primary category for the product (e.g. "Electronics", "Home & Garden").
- externalReferenceCode: string unique identifier for the product (for example "PRODUCT-001-1234567890").

IMPORTANT rules:

- For all multilingual fields (name, description, shortDescription, urls, metaDescription, metaKeyword, metaTitle, image title, specification value), create objects where each key is a language code from {{languageCodesCSV}} and each value is the content translated into that language.
- For urls, derive each value from the corresponding name: lowercase, spaces replaced by hyphens, remove characters that are not URL-friendly.
- Do NOT include any properties on the product objects other than:
  name, description, shortDescription, urls, baseSku, productType, skus, specifications, options, skuVariants, images, attachments, metaDescription, metaKeyword, metaTitle, externalReferenceCode, priceEntries, category, allowBackOrder, active.
- Do NOT wrap the array in an outer object (no "products" property). Return a JSON array only.
- Do NOT include explanations, comments, markdown, or backticks. Return raw JSON only.
- SKU Activation: For a SKU to be "Active" in Liferay, it MUST have an assigned value for EVERY option that is defined on the product. Ensure "skuVariants" objects include all options.
- Option Values: Predefined values ("values" array) are only for "select", "radio", "checkbox", "checkbox_multiple", and "select_date". Do not provide them for "numeric", "text", or "date".
