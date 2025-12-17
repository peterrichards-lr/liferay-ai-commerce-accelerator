Generate {{count}} realistic business account{{pluralSuffix}} with the following properties:
- name: Company name (string, required)
- type: Account type, always "business" (string, required)
- emailAddress: Company email (string, optional)
- taxId: Realistic tax ID format (string, optional)
- externalReferenceCode: Unique identifier (string, required)
- headOfficeAddress.addressCountry: Choose from the following list of countries: United States, United Kingdom, France, Germany, Australia, Japan, Brazil, India, Canada, Mexico, South Africa, United Arab Emirates, Singapore

Return as a JSON array that conforms to the provided JSON schema.