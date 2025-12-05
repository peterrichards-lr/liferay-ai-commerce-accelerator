Generate {{count}} realistic business account{{pluralSuffix}} with the following properties:
- name: Company name (string, required)
- type: Account type, always "business" (string, required)
- emailAddress: Company email (string, optional)
- taxId: Realistic tax ID format (string, optional)
- externalReferenceCode: Unique identifier (string, required)

Return as a JSON array that conforms to the provided JSON schema.