Generate {{pricingType}} pricing data for the provided products.

Products: {{=json:productListJSON}}

Return a single JSON object with the following structure:
{
"priceListName": "A descriptive name for the price list",
"priceEntries": [
{
"sku": "The product SKU",
"price": "The base price for the SKU",
"cost": "The cost for the SKU",
"tierPrices": [
{
"minQuantity": "The minimum quantity for the tier",
"price": "The price for the tier"
}
]
}
]
}

For {{pricingType}} pricing, generate:

- A descriptive `priceListName`.
- A `priceEntries` array for each product SKU.
- Each entry should have a `price` and `cost`.
- {{bulkHint}}
- {{tierHint}}
- {{promoHint}}

Use realistic e-commerce pricing strategies.

The response must be a single JSON object that conforms to the provided JSON schema.
