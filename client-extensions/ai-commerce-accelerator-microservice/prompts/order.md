Generate realistic order data for {{count}} orders using the provided products and accounts.

{% if groundingMetadata and groundingMetadata.languages %}
LIFERAY CONTEXT: You MUST only use the following active Liferay languages for any multilingual fields: {{ groundingMetadata.languages | map(attribute='id') | join(', ') }}.
{% endif %}

{% if brandName %}
BRAND CONTEXT: These orders represent business transactions with the brand/company "{{brandName}}".
{% endif %}

Available Products: {{=json:productListJSON}}
Available Accounts: {{=json:accountListJSON}}

Each order should have:

- accountId (from available accounts)
- items (2-5 items from available products with realistic quantities)
- orderStatus (numeric status: 0 for pending, 1 for processing, 10 for completed)
- externalReferenceCode (unique order identifier)
  {% if orderDateRangeDays and orderDateRangeDays > 0 %}
- orderDate (ISO 8601 date-time string). Distribute order dates realistically across the last {{orderDateRangeDays}} days (from now back to {{orderDateRangeDays}} days ago) rather than clustering them all on the same date. Older orders should skew toward earlier in that window and more recent activity toward the end, so the set reads as genuine order history over time.

REORDER PATTERNS: Some accounts should place more than one order across this date range (a "reorder"), each dated later than the previous one for that same account, often repeating one or more of the same items. Not every account needs a reorder, but the overall set should include a believable mix of first-time and repeat purchasers rather than every account ordering exactly once.
{% else %}

- orderDate (ISO 8601 date-time string). Use the current date/time for all orders.
  {% endif %}

Ensure realistic purchasing patterns (related products, reasonable quantities).
Return as a JSON array that conforms to the provided JSON schema.
