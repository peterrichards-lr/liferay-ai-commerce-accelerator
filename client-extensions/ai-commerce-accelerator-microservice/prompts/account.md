Generate {{count}} realistic account{{pluralSuffix}} with the following properties:

{{languageGuidance}}

{{brandGuidance}}

{{accountTypeGuidance}}
- type: Account type as instructed above, either "business" or "person" (string, required)
- externalReferenceCode: Unique identifier (string, required)
- headOfficeAddress: Head office address object. REQUIRED for every account - must contain addressCountry (full country name), addressLocality (city), addressRegion, postalCode and streetAddressLine1 (object, required)
  - headOfficeAddress.addressCountry: {{countryInstruction}}{{regionLine}}
- billingAddress: Billing address object. REQUIRED for every account - must contain addressCountry (full country name), addressLocality (city), addressRegion, postalCode and streetAddressLine1 (object, required)
- shippingAddress: Shipping address object. REQUIRED for every account - must contain addressCountry (full country name), addressLocality (city), addressRegion, postalCode and streetAddressLine1 (object, required)
  Return as a JSON array that conforms to the provided JSON schema.
