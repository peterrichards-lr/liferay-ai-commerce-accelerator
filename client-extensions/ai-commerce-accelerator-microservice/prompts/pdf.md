Generate comprehensive PDF content for a {{category}} product named "{{productName}}".

Create realistic content for:

1. Technical Specifications (detailed specs in table format)

1. Warranty Information (coverage, terms, contact info)

1. Marketing Brochure (features, benefits, selling points)

1. User Manual Excerpt (key usage instructions)

1. Safety Information (warnings, certifications)

Product Context:
- Name: {{productName}}
- Category: {{category}}
- Description: {{productDescription}}
- Specifications: {{=json:specificationsJSON}}

Return as JSON with sections:
{
  "title": "Product Documentation - [Product Name]",
  "sections": [
    { "title": "Technical Specifications", "content": "[detailed specs in readable format]" },
    { "title": "Warranty Information", "content": "[warranty details, coverage, terms]" },
    { "title": "Marketing Highlights", "content": "[key features and benefits]" },
    { "title": "Usage Guidelines", "content": "[basic usage instructions]" },
    { "title": "Safety & Compliance", "content": "[safety warnings, certifications]" }
  ]
}

Make content realistic and category-appropriate for {{category}} products.

The response must be a single JSON object that conforms to the provided JSON schema.