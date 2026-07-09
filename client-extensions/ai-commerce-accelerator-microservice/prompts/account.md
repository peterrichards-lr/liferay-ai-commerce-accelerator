Generate {{count}} realistic business account{{pluralSuffix}} with the following properties:

{% if groundingMetadata and groundingMetadata.languages %}
LIFERAY CONTEXT: You MUST only use the following active Liferay languages for any multilingual fields: {{ groundingMetadata.languages | map(attribute='id') | join(', ') }}.
{% endif %}

{% if brandName %}
BRAND CONTEXT: These accounts are potential customers or business partners for the brand/company "{{brandName}}".
{% endif %}

- name: Company name (string, required). The company names should be relevant to the following business categories: {{categories}}.
- type: Account type, always "business" (string, required)
- emailAddress: Company email (string, optional)
- taxId: Realistic tax ID format (string, optional)
- externalReferenceCode: Unique identifier (string, required)
- headOfficeAddress.addressCountry: {% if geographicContext %}{{geographicContext.countryTitle}}{% else %}Choose from the following list of countries: United States, United Kingdom, France, Germany, Australia, Japan, Brazil, India, Canada, Mexico, South Africa, United Arab Emirates, Singapore{% endif %}
  {% if geographicContext and geographicContext.regionTitle %}- headOfficeAddress.addressRegion: {{geographicContext.regionTitle}}{% endif %}
- billingAddress: Billing address object containing addressCountry, addressLocality, addressRegion, postalCode, streetAddressLine1 (object, optional)
- shippingAddress: Shipping address object containing addressCountry, addressLocality, addressRegion, postalCode, streetAddressLine1 (object, optional)
  Return as a JSON array that conforms to the provided JSON schema.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
