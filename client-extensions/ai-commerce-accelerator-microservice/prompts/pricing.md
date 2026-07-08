Generate {{pricingType}} pricing data for the provided products.

Products: {{=json:productListJSON}}

Return a single JSON object with the following structure:
{
"priceListName": "A descriptive name for the price list",
{% if brandName %}
LIFERAY CONTEXT: This price list is for products belonging to the brand "{{brandName}}".
{% endif %}
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

{% if groundingMetadata and groundingMetadata.currencies %}
LIFERAY CONTEXT: Please use the following active currency for all price entries: {{ groundingMetadata.currencies | map(attribute='code') | join(', ') }}.
{% endif %}

- A descriptive `priceListName`.
- A `priceEntries` array for each product SKU.
- Each entry should have a `price` and `cost`.
- {{bulkHint}}
- {{tierHint}}
- {{promoHint}}

Use realistic e-commerce pricing strategies.

The response must be a single JSON object that conforms to the provided JSON schema.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
