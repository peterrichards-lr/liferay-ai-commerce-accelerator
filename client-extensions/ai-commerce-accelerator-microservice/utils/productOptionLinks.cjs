const { fromI18n, sanitizeForERC } = require('./misc.cjs');

/**
 * `Sku.skuOptions` addresses the product definition's option and value
 * relationships, not the global option and option value definitions.
 *
 * Recorded from a live instance (accelerator-sdk api-schemas/examples): the
 * global option keyed `package-quantity` is id 71501, the `ProductOption` that
 * links it to product 71551 reports `optionId: 71501`, and the SKU that uses it
 * carries `{"key": "package-quantity", "optionId": 71565, "optionValueId":
 * 71566}`. 71565 is the relationship, not the definition.
 *
 * So the only step that can supply what create-skus needs is
 * link-product-options, and the ids it produces are kept under their own names.
 * ensure-options resolves the global definition into `optionId`, which is what
 * link-product-options must send and must therefore not overwrite. Sharing one
 * field for both meanings is how a global option id reached a SKU looking
 * entirely plausible while its value id stayed at zero. See #662.
 */

const LINKED_OPTION_ID = 'productOptionId';
const LINKED_OPTION_VALUES = 'productOptionValuesWithIds';
const LINKED_OPTION_VALUE_ID = 'productOptionValueId';

const UNRESOLVED = {
  OPTION_NOT_GENERATED: 'no such option on the product',
  OPTION_NOT_LINKED: 'option was not linked to the product definition',
  VALUE_NOT_LINKED: 'linked option carries no option values',
  VALUE_NOT_MATCHED: 'no linked option value with that name',
};

/**
 * Names arrive as plain strings from the AI and as localised maps from Liferay,
 * and `String({en_US: 'Black'})` sanitises to 'OBJECTOBJECT', which matches
 * nothing. Both sides go through this.
 */
function label(value) {
  return sanitizeForERC(
    typeof value === 'string' ? value : fromI18n(value) || ''
  );
}

function positiveId(...candidates) {
  for (const candidate of candidates) {
    const id = Number(candidate);
    if (Number.isFinite(id) && id > 0) {
      return id;
    }
  }
  return 0;
}

/**
 * The relationship ids Liferay reported for one linked option, or null when the
 * response did not carry them.
 *
 * Absent values are not the same as no values: the caller has to be able to
 * tell "Liferay answered without expanding productOptionValues" from "this
 * option genuinely has none", because the first is worth a read-back and the
 * second is not.
 */
function readLinkedOption(linkedOption) {
  const productOptionId = positiveId(
    linkedOption?.id,
    linkedOption?.[LINKED_OPTION_ID]
  );

  if (!productOptionId) {
    return null;
  }

  const reported = Array.isArray(linkedOption?.productOptionValues)
    ? linkedOption.productOptionValues
    : [];

  return {
    [LINKED_OPTION_ID]: productOptionId,
    [LINKED_OPTION_VALUES]: reported
      .map((value) => ({
        [LINKED_OPTION_VALUE_ID]: positiveId(
          value?.id,
          value?.[LINKED_OPTION_VALUE_ID]
        ),
        name: value?.name,
        key: value?.key,
      }))
      .filter((value) => value[LINKED_OPTION_VALUE_ID] > 0),
  };
}

/**
 * Liferay does not guarantee the key it echoes is the key that was sent - the
 * SDK's own key lookup compares case-insensitively for that reason - so the
 * global option id is kept as a second way in.
 */
function findLinkedOption(linkedOptions, { key, optionId } = {}) {
  const candidates = Array.isArray(linkedOptions) ? linkedOptions : [];
  const wantedKey = String(key || '').toLowerCase();

  const byKey =
    wantedKey &&
    candidates.find(
      (candidate) => String(candidate?.key || '').toLowerCase() === wantedKey
    );

  if (byKey) {
    return byKey;
  }

  const wantedOptionId = positiveId(optionId);

  return (
    (wantedOptionId &&
      candidates.find(
        (candidate) => positiveId(candidate?.optionId) === wantedOptionId
      )) ||
    null
  );
}

/**
 * The `{ optionId, optionValueId }` pair for one variant's option, or the
 * reason it could not be produced.
 *
 * A pair is only ever returned complete. There is no option value 0: Liferay
 * answers a SKU insert carrying one with ConstraintViolationException and
 * discards the whole batch.
 */
function resolveSkuOptionLink(productOptions, optionName, valueName) {
  const options = Array.isArray(productOptions) ? productOptions : [];
  const wantedOption = label(optionName);

  const option = options.find(
    (candidate) =>
      label(candidate?.name) === wantedOption ||
      candidate?.key === optionName ||
      label(candidate?.key) === wantedOption
  );

  if (!option) {
    return { reason: UNRESOLVED.OPTION_NOT_GENERATED };
  }

  const optionId = positiveId(option[LINKED_OPTION_ID]);

  if (!optionId) {
    return { reason: UNRESOLVED.OPTION_NOT_LINKED };
  }

  const linkedValues = Array.isArray(option[LINKED_OPTION_VALUES])
    ? option[LINKED_OPTION_VALUES]
    : [];

  if (linkedValues.length === 0) {
    return { reason: UNRESOLVED.VALUE_NOT_LINKED };
  }

  const wantedValue = label(valueName);
  const value = linkedValues.find(
    (candidate) =>
      label(candidate?.name) === wantedValue ||
      label(candidate?.key) === wantedValue
  );

  const optionValueId = positiveId(value?.[LINKED_OPTION_VALUE_ID]);

  if (!optionValueId) {
    return { reason: UNRESOLVED.VALUE_NOT_MATCHED };
  }

  return { optionId, optionValueId };
}

module.exports = {
  LINKED_OPTION_ID,
  LINKED_OPTION_VALUES,
  LINKED_OPTION_VALUE_ID,
  UNRESOLVED,
  findLinkedOption,
  label,
  readLinkedOption,
  resolveSkuOptionLink,
};
