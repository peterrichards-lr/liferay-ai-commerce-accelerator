Generate comprehensive PDF content for a {{category}} product named "{{productName}}".

{% if brandName %}
BRAND CONTEXT: This product belongs to the brand/company "{{brandName}}". The generated document should reflect this brand's voice and style.
{% endif %}

The focus of this document is: {{contentTypeLabel}}.

Create realistic and detailed sections appropriate for this type of document.

Product Context:

- Name: {{productName}}
- Category: {{category}}
- Description: {{productDescription}}
- Specifications: {{=json:specificationsJSON}}

Return as JSON with a title and an array of sections. Each section must have a "title" and "content".

Example structure:
{
"title": "Document Title",
"sections": [
{ "title": "Section Title", "content": "Detailed realistic content..." },
...
]
}

Ensure the content is high-quality, professional, and category-appropriate for {{category}} products.

The response must be a single JSON object that conforms to the provided JSON schema.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-02_ | _Last Reviewed: 2026-07-02_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-07-08_ | _Last Reviewed: 2026-07-08_
