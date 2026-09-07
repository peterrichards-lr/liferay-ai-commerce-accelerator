const { reconcileOptionFieldType } = require('../utils/optionFieldTypes.cjs');
const { COMMERCE_CONSTRAINTS } = require('../utils/commerceConstants.cjs');

describe('reconcileOptionFieldType', () => {
  // Liferay enforces the same rule twice, with a different class and a
  // different exception each time:
  //
  //   CPOptionLocalServiceImpl._validateCommerceOptionTypeKey
  //     -> CPOptionSKUContributorException          (ensure-options)
  //   CPDefinitionOptionRelLocalServiceImpl._validateCommerceOptionTypeKey
  //     -> CPDefinitionOptionSKUContributorException (link-product-options)
  //
  // The first fix satisfied only the first site, and the second went on
  // sending what Liferay rejects. Hence one shared helper.
  it('corrects a type Liferay will not accept from a contributor', () => {
    for (const fieldType of ['checkbox', 'checkbox_multiple', 'text']) {
      const result = reconcileOptionFieldType({
        fieldType,
        skuContributor: true,
        valueCount: 2,
      });

      expect(result.skuContributor).toBe(true);
      expect(COMMERCE_CONSTRAINTS.SKU_CONTRIBUTOR_FIELD_TYPES).toContain(
        result.fieldType
      );
      expect(result.adjusted).toBe(true);
    }
  });

  it('leaves an already valid contributor alone', () => {
    for (const fieldType of ['select', 'radio']) {
      const result = reconcileOptionFieldType({
        fieldType,
        skuContributor: true,
        valueCount: 1,
      });

      expect(result.fieldType).toBe(fieldType);
      expect(result.skuContributor).toBe(true);
      expect(result.adjusted).toBe(false);
    }
  });

  it('drops the flag rather than the type when there are no values', () => {
    // Nothing to vary on, so the option cannot define a variant whatever its
    // type - and a text option should stay a text option.
    const result = reconcileOptionFieldType({
      fieldType: 'text',
      skuContributor: true,
      valueCount: 0,
    });

    expect(result.skuContributor).toBe(false);
    expect(result.fieldType).toBe('text');
  });

  it('honours variants being disabled for the run', () => {
    const result = reconcileOptionFieldType({
      fieldType: 'select',
      skuContributor: true,
      valueCount: 3,
      allowSkuContribution: false,
    });

    expect(result.skuContributor).toBe(false);
  });

  it('never returns a type outside the OpenAPI list', () => {
    const result = reconcileOptionFieldType({
      fieldType: 'not_a_real_type',
      skuContributor: false,
      valueCount: 0,
    });

    expect(COMMERCE_CONSTRAINTS.VALID_FIELD_TYPES).toContain(result.fieldType);
  });

  it('defaults a missing type rather than sending undefined', () => {
    const result = reconcileOptionFieldType({ skuContributor: false });

    expect(result.fieldType).toBe('select');
  });

  it('excludes select_date, which Liferay permits but cannot process', () => {
    // Liferay allows select_date as a contributor, but a select_date option
    // value throws ArrayIndexOutOfBoundsException on validation. See #654.
    expect(COMMERCE_CONSTRAINTS.SAFE_SKU_CONTRIBUTOR_FIELD_TYPES).not.toContain(
      'select_date'
    );
    expect(COMMERCE_CONSTRAINTS.DEFAULT_SKU_CONTRIBUTOR_FIELD_TYPE).not.toBe(
      'select_date'
    );
  });
});
