/**
 * Which accounts may be given a generated order, and the single wording used
 * wherever that constraint is reported.
 *
 * Account.type in headless-admin-user-v1.0 is an enum of four values. Only two
 * of them are customers:
 *
 *   business  - a company that buys from the store (B2B)
 *   person    - an individual that buys from the store (B2C)
 *   guest     - anonymous checkout, enabled per channel; never an order owner
 *               that AICA should create
 *   supplier  - supplies the business rather than buying from it, so outside
 *               what AICA generates at all
 */
const CUSTOMER_ACCOUNT_TYPES = ['business', 'person'];

/**
 * Selection meaning "any customer account". Used when order generation runs
 * against existing data without the operator narrowing the type, which is the
 * behaviour standalone order runs had before this constraint existed.
 */
const ANY = 'any';

const SELECTION_LABELS = {
  any: 'customer',
  business: 'business',
  mixed: 'customer',
  person: 'individual',
};

function normalizeSelection(selection) {
  const value = String(selection || ANY)
    .trim()
    .toLowerCase();
  return value || ANY;
}

/**
 * The account types a selection permits. 'mixed' and 'any' both mean either
 * kind of customer; anything unrecognised is treated as 'any' rather than
 * rejected, so an unexpected value cannot empty the pool.
 */
function accountTypesForSelection(selection) {
  const value = normalizeSelection(selection);
  if (value === 'business' || value === 'person') return [value];
  return [...CUSTOMER_ACCOUNT_TYPES];
}

function accountType(account) {
  return String(account?.type || '')
    .trim()
    .toLowerCase();
}

/**
 * The accounts eligible to receive a generated order.
 *
 * An account whose type is missing is kept when any customer will do, because
 * the field may simply not have been returned and dropping it would empty the
 * pool for datasets that worked before. It is excluded once a specific type is
 * asked for, since an unknown type cannot be claimed to match.
 */
function eligibleOrderAccounts(accounts = [], selection) {
  const permitted = accountTypesForSelection(selection);
  const specific = permitted.length === 1;

  return accounts.filter((account) => {
    const type = accountType(account);
    if (!type) return !specific;
    return permitted.includes(type);
  });
}

/**
 * Returns a message explaining an empty pool, naming what was looked for and
 * what was actually there.
 */
function noEligibleAccountsMessage(selection, accounts = []) {
  const label = SELECTION_LABELS[normalizeSelection(selection)] || 'customer';
  const present = [...new Set(accounts.map(accountType).filter(Boolean))];

  const found = present.length
    ? `Found ${accounts.length} account(s), of type: ${present.sort().join(', ')}.`
    : `Found ${accounts.length} account(s), none reporting a type.`;

  return `No ${label} accounts are available to receive orders. ${found} Generate ${label} accounts first, or change the account type for this run.`;
}

module.exports = {
  ANY,
  CUSTOMER_ACCOUNT_TYPES,
  accountTypesForSelection,
  eligibleOrderAccounts,
  noEligibleAccountsMessage,
};
