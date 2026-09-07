const { validationFeedback } = require('../utils/validationFeedback.cjs');

// The errors ajv produced on 2026-09-07, when the model returned the whole
// product body nested inside `description` - a locale-to-string map.
const REAL_ERRORS = [
  'shortDescription',
  'urls',
  'skus',
  'specifications',
  'options',
  'skuVariants',
  'images',
  'attachments',
  'active',
  'allowBackOrder',
].map((field) => ({
  instancePath: `/products/0/description/${field}`,
  keyword: 'type',
  message: 'must be string',
  params: { type: 'string' },
  schemaPath:
    '#/properties/products/items/properties/description/additionalProperties/type',
}));

describe('validation feedback', () => {
  it('says nothing when there is nothing to correct', () => {
    for (const value of [null, undefined, []]) {
      expect(validationFeedback(value)).toBe('');
    }
  });

  it('tells the model its response was rejected and to return the whole thing again', () => {
    const text = validationFeedback(REAL_ERRORS);

    expect(text).toContain('YOUR PREVIOUS RESPONSE WAS REJECTED');
    expect(text).toContain('return the whole');
  });

  it('collapses the same mistake repeated across array elements', () => {
    // The real failure was one structural error reported ten times. Sending
    // ten near-identical lines wastes the budget and hides anything else.
    const across = [
      { ...REAL_ERRORS[0], instancePath: '/products/0/description/urls' },
      { ...REAL_ERRORS[0], instancePath: '/products/7/description/urls' },
      { ...REAL_ERRORS[0], instancePath: '/products/12/description/urls' },
    ];

    const lines = validationFeedback(across)
      .split('\n')
      .filter((line) => line.startsWith('- '));

    expect(lines).toHaveLength(1);
  });

  it('caps how many errors it reports and says how many were left out', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      instancePath: `/products/0/field${i}`,
      keyword: 'type',
      message: 'must be string',
      params: { type: 'string' },
    }));

    const text = validationFeedback(many);
    const lines = text.split('\n').filter((line) => line.startsWith('- '));

    expect(lines).toHaveLength(8);
    expect(text).toContain('22 further errors');
  });

  it('phrases each keyword as an instruction rather than an assertion', () => {
    const text = validationFeedback([
      {
        instancePath: '/products/0',
        keyword: 'additionalProperties',
        params: { additionalProperty: 'colour' },
      },
      {
        instancePath: '/products/0',
        keyword: 'required',
        params: { missingProperty: 'baseSku' },
      },
      {
        instancePath: '/products/0/productType',
        keyword: 'enum',
        params: { allowedValues: ['simple', 'grouped'] },
      },
    ]);

    expect(text).toContain('remove the unexpected property "colour"');
    expect(text).toContain('the required property "baseSku" is missing');
    expect(text).toContain('must be one of simple, grouped');
  });

  it('names the nesting mistake that caused the original failure', () => {
    // Ten "must be string" errors do not tell a model what it did wrong. The
    // hint is what turns the feedback into something actionable.
    expect(validationFeedback(REAL_ERRORS)).toContain(
      'nesting a whole object inside a field that expects a string'
    );
  });
});
