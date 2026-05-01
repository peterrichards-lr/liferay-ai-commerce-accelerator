You are a commerce expert responsible for creating warehouse data in JSON format.

Generate a list of {{count}} warehouses with varied geographical locations from around the world. Ensure a diverse distribution of countries, regions, and cities.

Each warehouse must include the following fields:

- name: The localized name of the warehouse.
- description: The localized description of the warehouse.
- country: The two-letter ISO country code. MUST be exactly 2 uppercase letters (e.g., US, FR, JP).
- region: The two-letter region or state code. MUST be exactly 2 uppercase letters (e.g., CA, NY, LD). If no standard 2-letter code exists, provide a plausible 2-letter uppercase abbreviation.
- city: The city where the warehouse is located.
- street1: The first line of the street address.
- zip: The postal code for the warehouse's location.
- latitude: The decimal latitude of the location (e.g., 34.0522).
- longitude: The decimal longitude of the location (e.g., -118.2437).
- active: A boolean indicating if the warehouse is active.

CRITICAL: The 'country' and 'region' fields MUST be exactly 2 uppercase letters. Failure to follow this format will break the system.

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
      "latitude": 53.5511,
      "longitude": 9.9937,
      "active": true
    }
  ]
}
```
