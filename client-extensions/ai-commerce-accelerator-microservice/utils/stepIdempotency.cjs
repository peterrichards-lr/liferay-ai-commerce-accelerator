const { WORKFLOW_STEPS } = require('./constants.cjs');

/**
 * What happens to a Liferay instance when a step runs a second time.
 *
 * Resume re-enters a failed session at the step that failed, so the question
 * every step has to answer is not "did it work" but "what does a second
 * attempt leave behind". #895 summarised the flows as "most steps are
 * idempotent by ERC"; *most* is the problem, and this table is the audit that
 * replaces the word. Each entry cites the call site that decides it, so the
 * claim can be checked against the code rather than against this comment.
 *
 * - `NO_WRITE` sends nothing to Liferay. It reads, waits, or rewrites the
 *   session context. The `generate-*-data` steps are here and deserve a note:
 *   a second attempt calls the model again and replaces the list it produced,
 *   new external reference codes and all. That is safe only because the engine
 *   cannot reach one of these except as the re-entry point - a step is PENDING
 *   only while nothing after it in its sequence has run, so nothing has
 *   consumed the list being replaced. On the import path they do not even do
 *   that: the list arrives in the context and the step passes it through
 *   (`generation.cjs:28`).
 * - `ERC_UPSERT` writes through Liferay's batch engine with
 *   `createStrategy: 'UPSERT'` keyed on an external reference code the session
 *   context already holds, so the second attempt updates the row the first one
 *   created.
 * - `CONVERGES` reads what exists before it writes, absorbs the conflict
 *   Liferay raises for a duplicate, or overwrites a field with a value that
 *   does not depend on what was there. A second attempt leaves the same state.
 * - `UNSAFE` duplicates or is rejected. Resume refuses to re-enter one of
 *   these rather than guessing across it.
 */
const RERUN_SAFETY = {
  NO_WRITE: 'NO_WRITE',
  ERC_UPSERT: 'ERC_UPSERT',
  CONVERGES: 'CONVERGES',
  UNSAFE: 'UNSAFE',
};

const S = WORKFLOW_STEPS;

const { NO_WRITE, ERC_UPSERT, CONVERGES, UNSAFE } = RERUN_SAFETY;

/**
 * Every key in `WORKFLOW_STEPS`, classified, with the reason it is classified
 * that way. `stepIdempotency.test.cjs` holds the two in step: a step key
 * without an entry fails the suite, which is the point - a new step is a new
 * decision about whether a failed run can be resumed through it.
 */
const STEP_RERUN_SAFETY = {
  [S.DISCOVER]: {
    safety: NO_WRITE,
    why: 'declared in WORKFLOW_STEPS and scheduled by no flow',
  },

  // --- metadata and generation -------------------------------------------
  [S.LOAD_COUNTRIES]: {
    safety: NO_WRITE,
    why: 'reads countries (accountGenerator.cjs:67)',
  },
  [S.LOAD_LANGUAGES]: {
    safety: NO_WRITE,
    why: 'reads languages (accountGenerator.cjs:112)',
  },
  [S.LOAD_METADATA]: {
    safety: NO_WRITE,
    why: 'reads languages, currencies and vocabularies (metadata.cjs:19)',
  },
  [S.GENERATE_ACCOUNT_DATA]: {
    safety: NO_WRITE,
    why: 'writes session context only (accountGenerator.cjs:139)',
  },
  [S.GENERATE_WAREHOUSE_DATA]: {
    safety: NO_WRITE,
    why: 'writes session context only (warehouseGenerator.cjs:222)',
  },
  [S.GENERATE_PRODUCT_DATA]: {
    safety: NO_WRITE,
    why: 'writes session context only; an import passes the list through (generation.cjs:28)',
  },
  [S.GENERATE_ORDER_DATA]: {
    safety: NO_WRITE,
    why: 'writes session context only; an import passes the list through (orderGenerator.cjs:123)',
  },
  [S.GENERATE_PROMO_DATA]: {
    safety: NO_WRITE,
    why: 'writes session context only (PromoGenerator.cjs:56)',
  },

  // --- id resolution ------------------------------------------------------
  [S.RESOLVE_ACCOUNT_IDS]: {
    safety: NO_WRITE,
    why: 'resolves accounts by ERC and records the ids (accountGenerator.cjs:500)',
  },
  [S.RESOLVE_WAREHOUSE_IDS]: {
    safety: NO_WRITE,
    why: 'resolves warehouses by ERC and records the ids (warehouseGenerator.cjs:70)',
  },
  [S.RESOLVE_PRODUCT_IDS]: {
    safety: NO_WRITE,
    why: 'resolves products by ERC and records the ids (products.cjs:197)',
  },
  [S.RESOLVE_SKU_IDS]: {
    safety: NO_WRITE,
    why: 'resolves SKUs by ERC and records the ids (skus.cjs:99)',
  },

  // --- waits --------------------------------------------------------------
  [S.SYNC_DELAY]: { safety: NO_WRITE, why: 'waits (baseGenerator.cjs:88)' },
  [S.SYNC_DELAY_PRICING]: {
    safety: NO_WRITE,
    why: 'waits (baseGenerator.cjs:88)',
  },
  [S.SYNC_DELAY_MEDIA]: {
    safety: NO_WRITE,
    why: 'waits (baseGenerator.cjs:88)',
  },
  [S.SYNC_DELAY_ORDERS]: {
    safety: NO_WRITE,
    why: 'polls until products are indexed (baseGenerator.cjs:120)',
  },

  // --- batch upserts ------------------------------------------------------
  [S.CREATE_ACCOUNTS]: {
    safety: ERC_UPSERT,
    why: 'UPSERT batch, and rest.cjs:1196 looks the accounts up first (accountGenerator.cjs:461)',
  },
  [S.CREATE_POSTAL_ADDRESSES]: {
    safety: ERC_UPSERT,
    why: 'UPSERT batch on an ERC derived from the account and the address, so a rerun updates rather than duplicates (accountGenerator.cjs:597)',
  },
  [S.CREATE_WAREHOUSES]: {
    safety: ERC_UPSERT,
    why: 'UPSERT batch on the warehouse ERC (warehouseGenerator.cjs:472)',
  },
  [S.CREATE_PRODUCTS]: {
    safety: ERC_UPSERT,
    why: 'UPSERT batch on the product ERC (products.cjs:155)',
  },
  [S.CREATE_PRODUCT_SKUS]: {
    safety: ERC_UPSERT,
    why: 'UPSERT batch of products carrying their SKUs, each with its own ERC (skus.cjs:552)',
  },
  [S.CREATE_ORDERS]: {
    safety: ERC_UPSERT,
    why: 'UPSERT batch on the order ERC, which generate-order-data persisted (orderGenerator.cjs:389)',
  },

  // --- reads before it writes --------------------------------------------
  [S.ENSURE_CATEGORIES]: {
    safety: CONVERGES,
    why: 'indexes the vocabulary and creates only what is missing (categories.cjs:119)',
  },
  [S.ENSURE_SPECIFICATION_CATEGORIES]: {
    safety: CONVERGES,
    why: 'createSpecificationCategoryWithReuse looks up before it posts (specifications.cjs:56)',
  },
  [S.ENSURE_SPECIFICATIONS]: {
    safety: CONVERGES,
    why: 'createSpecificationWithReuse looks up before it posts (specifications.cjs:153)',
  },
  [S.ENSURE_OPTIONS]: {
    safety: CONVERGES,
    why: 'createOptionWithReuse looks up by ERC then by key before it posts (specifications.cjs:347)',
  },
  [S.LINK_PRODUCT_OPTIONS]: {
    safety: CONVERGES,
    why: "reads the definition's existing options and posts only the ones missing (skus.cjs:254)",
  },
  [S.LINK_PRODUCT_CHANNELS]: {
    safety: CONVERGES,
    why: 'reads the product channels and patches only the missing ids (products.cjs:406)',
  },
  [S.LINK_WAREHOUSE_CHANNELS]: {
    safety: CONVERGES,
    why: 'createWarehouseChannel treats a 409 as already linked (warehouseGenerator.cjs:158)',
  },
  [S.UPDATE_INVENTORY]: {
    safety: CONVERGES,
    why: 'an existing warehouse item is absorbed rather than failed (inventory.cjs:43)',
  },
  [S.GENERATE_PRICE_LISTS]: {
    safety: CONVERGES,
    why: 'the list ERC carries the session id and each entry carries the existing priceEntryId (pricing.cjs:582, pricing.cjs:707)',
  },
  [S.GENERATE_BULK_PRICING]: {
    safety: CONVERGES,
    why: 'same resolution as create-price-lists, filtered to bulk entries (pricing.cjs:61)',
  },
  [S.GENERATE_TIER_PRICING]: {
    safety: CONVERGES,
    why: 'same resolution as create-price-lists, filtered to tier entries (pricing.cjs:86)',
  },
  [S.UPDATE_CATALOG_CONFIG]: {
    safety: CONVERGES,
    why: 'writes the base-price-list flag to the value it should already hold (pricing.cjs:132)',
  },
  [S.SET_ADDRESS_DEFAULTS]: {
    safety: CONVERGES,
    why: 'patches the account with the address ids it already resolved (accountGenerator.cjs:708)',
  },
  [S.CREATE_USER_SEGMENTS]: {
    safety: CONVERGES,
    why: 'reads the account group by ERC before creating it (PromoGenerator.cjs:204)',
  },
  [S.CREATE_PROMOTIONS]: {
    safety: CONVERGES,
    why: 'reads the price list by ERC before creating it, and its entries carry stable ERCs (PromoGenerator.cjs:305)',
  },

  // --- media --------------------------------------------------------------
  //
  // Both carry a deterministic ERC and read the product's existing attachments
  // before posting, so a second attempt attaches nothing it already attached
  // (#1040). They converge rather than upsert: the ERC identifies the
  // attachment and the read decides, because a POST carrying an existing ERC is
  // not established to upsert and that could not be established without a live
  // instance.
  //
  // A media failure is still recorded BYPASSED rather than FAILED
  // (media.cjs:137), which is terminal, so neither is a step a resume re-enters
  // today. That is now true by two independent facts rather than one.
  [S.ATTACH_IMAGES]: {
    safety: CONVERGES,
    why: 'reads the product images and posts only the ERCs it does not carry (mediaGenerator.cjs)',
  },
  [S.ATTACH_PDFS]: {
    safety: CONVERGES,
    why: 'reads the product attachments and posts only the ERCs it does not carry (mediaGenerator.cjs)',
  },

  // --- structural ---------------------------------------------------------
  [S.SUBFLOW_ACCOUNTS]: {
    safety: NO_WRITE,
    why: 'names a group of steps rather than work of its own',
  },
  [S.SUBFLOW_PRODUCTS]: {
    safety: NO_WRITE,
    why: 'names a group of steps rather than work of its own',
  },
  [S.SUBFLOW_ORDERS]: {
    safety: NO_WRITE,
    why: 'names a group of steps rather than work of its own',
  },

  // --- deletion -----------------------------------------------------------
  //
  // Removing what is already gone is the outcome the step asked for, and the
  // delete flow does not stop on a failed step at all - executeNextStep treats
  // a delete as try-every-step (baseGenerator.cjs:647) - so a delete session
  // never reaches the FAILED-with-a-step-to-re-enter shape resume acts on.
  [S.RESET_CATALOG_CONFIG]: {
    safety: CONVERGES,
    why: 'clears catalog flags that are already clear (deleteCoordinatorService.cjs:77)',
  },
  [S.DELETE_ORDERS]: { safety: CONVERGES, why: 'removes what is still there' },
  [S.DELETE_WAREHOUSES]: {
    safety: CONVERGES,
    why: 'removes what is still there',
  },
  [S.DELETE_WAREHOUSE_ITEMS]: {
    safety: CONVERGES,
    why: 'removes what is still there',
  },
  [S.DELETE_ACCOUNTS]: {
    safety: CONVERGES,
    why: 'removes what is still there',
  },
  [S.DELETE_PRODUCTS]: {
    safety: CONVERGES,
    why: 'removes what is still there',
  },
  [S.DELETE_PRODUCT_OPTIONS]: {
    safety: CONVERGES,
    why: 'detaches associations that may already be gone',
  },
  [S.DELETE_PRODUCT_SPECIFICATIONS]: {
    safety: CONVERGES,
    why: 'detaches associations that may already be gone',
  },
  [S.DELETE_PRICE_LISTS]: {
    safety: CONVERGES,
    why: 'removes what is still there',
  },
  [S.DELETE_PROMOTIONS]: {
    safety: CONVERGES,
    why: 'removes what is still there',
  },
  [S.DELETE_ACCOUNT_GROUPS]: {
    safety: CONVERGES,
    why: 'removes what is still there',
  },
  [S.DELETE_SPECIFICATIONS]: {
    safety: CONVERGES,
    why: 'removes what is still there',
  },
  [S.DELETE_OPTIONS]: { safety: CONVERGES, why: 'removes what is still there' },
  [S.DELETE_OPTION_CATEGORIES]: {
    safety: CONVERGES,
    why: 'removes what is still there',
  },
  [S.DELETE_PRODUCT_RELATED]: {
    safety: CONVERGES,
    why: 'detaches associations that may already be gone',
  },
};

/**
 * An unclassified step is unsafe rather than safe. A step key this table has
 * never heard of is a step nobody has audited, and resume's whole contract is
 * that it does not guess.
 */
function rerunSafetyOf(stepKey) {
  return STEP_RERUN_SAFETY[stepKey]?.safety ?? UNSAFE;
}

function rerunReasonFor(stepKey) {
  return (
    STEP_RERUN_SAFETY[stepKey]?.why ??
    'no idempotency classification exists for this step'
  );
}

function isSafeToRerun(stepKey) {
  return rerunSafetyOf(stepKey) !== UNSAFE;
}

module.exports = {
  RERUN_SAFETY,
  STEP_RERUN_SAFETY,
  isSafeToRerun,
  rerunReasonFor,
  rerunSafetyOf,
};
