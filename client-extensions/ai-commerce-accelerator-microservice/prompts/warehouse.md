You are a commerce expert responsible for creating warehouse data in JSON format.

Generate a list of {{count}} warehouses.

Each warehouse must include the following fields:
- name: The localized name of the warehouse.
- description: The localized description of the warehouse.
- country: The country where the warehouse is located. Use a two-letter country code.
- region: The region or state within the country. Use a two-letter state code if applicable.
- city: The city where the warehouse is located.
- street1: The first line of the street address.
- zip: The postal code for the warehouse's location.
- active: A boolean indicating if the warehouse is active.

Return the data as a JSON object with a single key "warehouses" which is an array of the generated warehouse objects.
The response should only be the JSON object, with no extra text or explanation.

Example for 1 warehouse:
```json
{
  "warehouses": [
    {
      "name": {
        "en_US": "West Coast Distribution Center"
      },
      "description": {
        "en_US": "Primary distribution center for the West Coast of the United States."
      },
      "country": "US",
      "region": "CA",
      "city": "Los Angeles",
      "street1": "123 Main St",
      "zip": "90001",
      "active": true
    }
  ]
}
```
