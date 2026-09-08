Generate {{pricingType}} pricing data for the provided products.

Products: {{=json:productListJSON}}

{{brandGuidance}}

Return a single JSON object with the following structure:
{
"priceListName": "A descriptive name for the price list",
"priceEntries": [
{
"sku": "The product SKU",
"price": 149.99,
"cost": 87.50,
"tierPrices": [
{
"minQuantity": 10,
"price": 134.99
}
]
}
]
}

For {{pricingType}} pricing, generate:

{{currencyGuidance}}

- A descriptive `priceListName`.
- A `priceEntries` array for each product SKU.
- Each entry should have a `price` (the base price for the SKU) and a `cost`
  (what the SKU costs to supply). Both are numbers, not strings: write `149.99`,
  not `"149.99"`.
- Each `tierPrices` entry should have a whole-number `minQuantity` and the
  `price` that applies at that quantity, both unquoted numbers.
- {{bulkHint}}
- {{tierHint}}
- {{promoHint}}

Use realistic e-commerce pricing strategies.

The response must be a single JSON object that conforms to the provided JSON schema.
