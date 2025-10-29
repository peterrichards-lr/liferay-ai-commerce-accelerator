Generate realistic order data for {{count}} orders using the provided products and accounts.

Available Products: {{=json:productListJSON}}
Available Accounts: {{=json:accountListJSON}}

Each order should have:
- accountId (from available accounts)
- orderItems (2-5 items from available products with realistic quantities)
- orderStatus (pending, processing, or completed)
- paymentStatus (pending, authorized, or paid)
- billingAddress (realistic address)
- shippingAddress (realistic address, can be same as billing)
- externalReferenceCode (unique order identifier)

Ensure realistic purchasing patterns (related products, reasonable quantities).
Return as JSON array with proper structure for Liferay Commerce API.