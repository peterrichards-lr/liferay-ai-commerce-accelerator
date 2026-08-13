Generate {{count}} realistic account{{pluralSuffix}} with the following properties:

{% if groundingMetadata and groundingMetadata.languages %}
LIFERAY CONTEXT: You MUST only use the following active Liferay languages for any multilingual fields: {{ groundingMetadata.languages | map(attribute='id') | join(', ') }}.
{% endif %}

{% if brandName %}
BRAND CONTEXT: These accounts are potential customers or business partners for the brand/company "{{brandName}}".
{% endif %}

{% if accountType == 'person' %}
ACCOUNT TYPE: Every account must be an individual/consumer account. Set "type" to "person" for all accounts.

- name: The individual's full name (string, required), relevant to the following context: {{categories}}.
- emailAddress: A personal email address for that individual, e.g. firstname.lastname@example.com (string, optional)
- taxId: Omit this field for person accounts; do not include it.
  {% elif accountType == 'mixed' %}
  ACCOUNT TYPE: Generate a realistic mix of both "business" and "person" accounts across the {{count}} account{{pluralSuffix}} (roughly half of each, unless the context below suggests a different split). For "business" accounts, use a company name and set "type" to "business". For "person" accounts, use an individual's full name and set "type" to "person"; omit "taxId" for these.
- name: Company name for "business" accounts, or the individual's full name for "person" accounts (string, required). Business names should be relevant to the following business categories: {{categories}}.
- emailAddress: Company email for "business" accounts, or a personal email for "person" accounts (string, optional)
- taxId: Realistic tax ID format, only for "business" accounts (string, optional)
  {% else %}
  ACCOUNT TYPE: Every account must be a business account. Set "type" to "business" for all accounts.
- name: Company name (string, required). The company names should be relevant to the following business categories: {{categories}}.
- emailAddress: Company email (string, optional)
- taxId: Realistic tax ID format (string, optional)
  {% endif %}
- type: Account type as instructed above, either "business" or "person" (string, required)
- externalReferenceCode: Unique identifier (string, required)
- headOfficeAddress.addressCountry: {% if geographicContext %}{{geographicContext.countryTitle}}{% else %}Choose from the following list of countries: United States, United Kingdom, France, Germany, Australia, Japan, Brazil, India, Canada, Mexico, South Africa, United Arab Emirates, Singapore{% endif %}
  {% if geographicContext and geographicContext.regionTitle %}- headOfficeAddress.addressRegion: {{geographicContext.regionTitle}}{% endif %}
- billingAddress: Billing address object containing addressCountry, addressLocality, addressRegion, postalCode, streetAddressLine1 (object, optional)
- shippingAddress: Shipping address object containing addressCountry, addressLocality, addressRegion, postalCode, streetAddressLine1 (object, optional)
  Return as a JSON array that conforms to the provided JSON schema.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-08-13_ | _Last Reviewed: 2026-08-13_
