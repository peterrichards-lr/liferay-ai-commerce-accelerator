Generate realistic product data for {{count}} {{category}} products with multilingual content for these languages: {{languageList}}.

Each product should have:
- name (object with language codes as keys: {{languageCodesNamePairs}})
- description (object with language codes as keys for detailed, marketing-friendly descriptions)
- shortDescription (object with language codes as keys for brief summaries)
- urls (object with language codes as keys for lowercase names with no spaces)
- baseSku (base SKU without variants - required for creating basic SKUs)
- productType (simple)
- skus (array with at least one basic SKU object with: sku, cost, price, inventoryLevel, published, purchasable, neverExpire, externalReferenceCode)
- specifications (3-5 realistic specs with key-value pairs)
- options (2-3 product variants contextually appropriate for {{category}} products)
- skuVariants (array of SKUs generated from option combinations with pricing variations)
- attachments (2-3 realistic document names like manuals, warranties)
- metaDescription (object with language codes as keys for SEO-friendly descriptions)
- metaKeyword (object with language codes as keys for comma-separated keywords)
- metaTitle (object with language codes as keys for SEO titles)
- externalReferenceCode (unique identifier)

IMPORTANT: For multilingual fields (name, description, shortDescription, urls, metaDescription, metaKeyword, metaTitle),
create objects where each key is a language code ({{languageCodesCSV}}) and each value is the content translated into that language.

For URLs, use the name in lowercase with spaces replaced by hyphens.

Example structure:
{
  "name": {
    {{languageCodesNameBlock}}
  },
  "urls": {
    {{languageCodesUrlBlock}}
  },
  "baseSku": "PRODUCT-001",
  "skus": [{
    "sku": "PRODUCT-001",
    "cost": 60,
    "price": 100,
    "inventoryLevel": 25,
    "published": true,
    "purchasable": true,
    "neverExpire": true,
    "externalReferenceCode": "PRODUCT-001"
  }],
  "externalReferenceCode": "PRODUCT-001-1234567890"
}

For {{category}} products, generate contextually appropriate options (category-specific suggestions are expected).

For skuVariants, generate individual SKUs for meaningful option combinations (limit to 8-12 variants per product):
- sku (baseSku + variant codes like "-BLK-L" for Black Large)
- options (the specific option combination like {"color": "Black", "size": "Large"})
- priceModifier (percentage adjustment: -15% to +30% from base price, with premium options costing more)
- inStock (90% should be true, 10% false for realism)

Return as JSON array with proper structure for Liferay Commerce API.