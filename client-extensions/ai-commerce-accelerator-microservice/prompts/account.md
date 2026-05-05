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
- headOfficeAddress.addressCountry: {% if geographicContext %}{{geographicContext.countryISOCode3}}{% else %}Choose from the following list of countries: USA, GBR, FRA, DEU, AUS, JPN, BRA, IND, CAN, MEX, ZAF, ARE, SGP{% endif %}
  {% if geographicContext and geographicContext.regionISOCode %}- headOfficeAddress.addressRegion: {{geographicContext.regionISOCode}}{% endif %}
  Return as a JSON array that conforms to the provided JSON schema.
