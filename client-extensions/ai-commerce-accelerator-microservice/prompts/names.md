Produce {{count}} distinct product name{{pluralSuffix}} for a catalogue of {{categoryList}} products.

{{brandGuidance}}

You must return a JSON object that conforms to the provided JSON schema: a single "names" property whose value is an array of objects. Each element must have exactly:

- name: string, the product name in English. A human-friendly retail name, of the kind that would appear on a product page.
- category: string, which MUST be one of exactly these: {{categoryList}}.

IMPORTANT rules:

- Distinctness is the whole purpose of this request. Every name must describe a genuinely different product. A rewording, a re-abbreviation, a near-duplicate or the same product at a different size is not a different product. Two names that a customer would read as the same item are a failure, even when the strings differ.
- Spread the names across the categories given rather than exhausting one. Aim for a roughly even distribution, adjusted for how much range each category realistically has.
- Vary the kind of product within a category, not just the adjective. Prefer a range of genuinely different items over a family of variants on one item.
- Do not number the names, do not add a brand prefix to every one of them, and do not include model codes or SKUs. The name alone.
- Return exactly {{count}} object{{pluralSuffix}} in the "names" array. Fewer is a failed response.
- Do NOT include explanations, comments, markdown, or backticks. Return raw JSON only.

{{vocabularyGuidance}}
