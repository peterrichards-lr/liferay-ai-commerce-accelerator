You are a commerce expert responsible for creating warehouse data in JSON format.

Generate a list of {{count}} warehouses with varied geographical locations from around the world. Ensure a diverse distribution of countries, regions, and cities.

Each warehouse must include the following fields:
- name: The localized name of the warehouse.
- description: The localized description of the warehouse.
- country: The country where the warehouse is located. Use a two-letter country code (e.g., US, DE, JP, AU).
- region: The region or state within the country. Use a two-letter state/region code if applicable (e.g., CA for California, BY for Bavaria, NSW for New South Wales).
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
        "en_US": "Global Distribution Hub"
      },
      "description": {
        "en_US": "A central distribution facility serving various international markets."
      },
      "country": "DE",
      "region": "HH",
      "city": "Hamburg",
      "street1": "Hafenstr. 10",
      "zip": "20095",
      "active": true
    }
  ]
}
```