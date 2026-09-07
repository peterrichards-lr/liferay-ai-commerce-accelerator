Generate {{count}} realistic account{{pluralSuffix}} with the following properties:

{{languageGuidance}}

{{brandGuidance}}

{{accountTypeGuidance}}
- type: Account type as instructed above, either "business" or "person" (string, required)
- externalReferenceCode: Unique identifier (string, required)
- headOfficeAddress.addressCountry: {{countryInstruction}}{{regionLine}}
- billingAddress: Billing address object containing addressCountry, addressLocality, addressRegion, postalCode, streetAddressLine1 (object, optional)
- shippingAddress: Shipping address object containing addressCountry, addressLocality, addressRegion, postalCode, streetAddressLine1 (object, optional)
  Return as a JSON array that conforms to the provided JSON schema.
