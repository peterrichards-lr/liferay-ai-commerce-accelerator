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

Ensure realistic purchasing patterns (related products, reasonable quantities).
Return as a JSON array that conforms to the provided JSON schema.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
