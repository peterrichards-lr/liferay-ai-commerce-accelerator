Generate realistic order data for {{count}} orders using the provided products and accounts.

Available Products: {{=json:productListJSON}}
Available Accounts: {{=json:accountListJSON}}

Each order should have:

- accountId (from available accounts)
- items (2-5 items from available products with realistic quantities)
- orderStatus (numeric status: 0 for pending, 1 for processing, 10 for completed)
- externalReferenceCode (unique order identifier)

Ensure realistic purchasing patterns (related products, reasonable quantities).
Return as a JSON array that conforms to the provided JSON schema.
