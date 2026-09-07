const { createERC } = require('./misc.cjs');
const { ERC_PREFIX } = require('./constants.cjs');

/**
 * Keeps the external reference code a model supplied only when it is usable
 * and unique within the run.
 *
 * The order prompts illustrate the field - "e.g. ORD-001" - and the model has
 * been observed copying that example onto every order. Liferay then rejects
 * the whole batch with `ConstraintViolationException: could not execute
 * batch`, naming the constraint rather than the duplicate, so it reads as a
 * platform fault rather than as data the run produced.
 *
 * Products avoid this by always generating their own code. Orders keep a
 * supplied one so that re-importing an exported dataset preserves identity,
 * which is why this de-duplicates rather than overriding outright.
 */
function uniqueOrderERC(supplied, seen) {
  const candidate = String(supplied || '').trim();

  if (candidate && !seen.has(candidate)) {
    seen.add(candidate);
    return candidate;
  }

  let erc = createERC(ERC_PREFIX.ORDER);

  while (seen.has(erc)) {
    erc = createERC(ERC_PREFIX.ORDER);
  }

  seen.add(erc);
  return erc;
}

/**
 * Applies uniqueOrderERC across a list, so the guarantee holds per run rather
 * than per call site. Both the generated and the imported paths use this.
 */
function withUniqueOrderERCs(orders) {
  const seen = new Set();

  return (orders || []).map((order) => ({
    ...order,
    externalReferenceCode: uniqueOrderERC(order?.externalReferenceCode, seen),
  }));
}

module.exports = { uniqueOrderERC, withUniqueOrderERCs };
