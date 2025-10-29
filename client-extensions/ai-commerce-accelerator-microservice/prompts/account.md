Generate {{count}} realistic business account{{pluralSuffix}} with the following properties:
- name: Company name (string, required)
- description: Business description (string, optional)
- type: Account type, always "business" (string, required)
- domains: Array of domain names (array of strings, optional)
- emailAddress: Company email (string, optional)
- taxId: Realistic tax ID format (string, optional)
- externalReferenceCode: Unique identifier (string, required)
- addresses: Billing and shipping addresses with realistic data (array of objects, optional)
- organizations: Department/subsidiary info (array of objects, optional)
- users: 2-3 business users with roles like Admin, Buyer, etc. (array of objects, optional)

IMPORTANT: Do NOT include an 'active' property as it's not supported by the API schema.

Return as JSON array with proper structure for Liferay Commerce API.