Generate logical user segments and target commerce promotions for the provided products and B2B accounts.

Products: {{=json:productListJSON}}
Accounts: {{=json:accountListJSON}}

Return a single JSON object with the following structure:
{
"userSegments": [
{
"name": "The name of the user segment (e.g. Heavy Industrial Contractors, Frequent Buyers)",
"description": "Detailed description of who belongs to this segment",
"externalReferenceCode": "Unique external reference code for the user segment (use uppercase with hyphens, e.g. SEG-HEAVY-CONTRACTORS)"
}
],
"promotions": [
{
"name": "The name of the promotion (e.g. 15% off Drills for Contractors)",
"description": "Detailed description of the promotion",
"discountPercentage": "The percentage discount for the promotion (e.g. 15)",
"targetSegmentName": "The name of the user segment this promotion targets (must match one of the userSegments names generated above)",
"externalReferenceCode": "Unique external reference code for the promotion (use uppercase with hyphens, e.g. PROMO-CONTRACTORS-15)"
}
]
}

Provide:

- 2-3 logical `userSegments` that represent realistic customer personas or purchaser groups based on the account details.
- 2-3 matching `promotions` with a `discountPercentage` between 5 and 30.
- Ensure `targetSegmentName` exactly references the `name` of one of the generated `userSegments`.

The response must be a single JSON object that conforms to the provided JSON schema.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
