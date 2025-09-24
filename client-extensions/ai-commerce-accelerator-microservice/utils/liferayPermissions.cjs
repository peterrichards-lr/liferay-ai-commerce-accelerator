/** ---------------------------------------------
 *  Constants
 * ----------------------------------------------*/
const ACTION_IDS = {
  ACCESS: 'ACCESS',
  ADD_DISCUSSION: 'ADD_DISCUSSION',
  ADD_DOCUMENT: 'ADD_DOCUMENT',
  ADD_SHORTCUT: 'ADD_SHORTCUT',
  ADD_SUBFOLDER: 'ADD_SUBFOLDER',
  DELETE_DISCUSSION: 'DELETE_DISCUSSION',
  DELETE: 'DELETE',
  DOWNLOAD: 'DOWNLOAD',
  OVERRIDE_CHECKOUT: 'OVERRIDE_CHECKOUT',
  PERMISSIONS: 'PERMISSIONS',
  SUBSCRIBE: 'SUBSCRIBE',
  UPDATE_DISCUSSION: 'UPDATE_DISCUSSION',
  UPDATE: 'UPDATE',
  VIEW: 'VIEW',
};

const ROLE = {
  GUEST: 'Guest',
  OWNER: 'Owner',
  SITE_MEMBER: 'Site Member',
  USER: 'User',
};

const ASSET_TYPE = {
  DOCUMENT_FOLDER: 'document-folder',
  DOCUMENT: 'document',
};

const VIEWABLE_BY = {
  OWNER: 'owner', // Only owner can view (others: no VIEW/DOWNLOAD unless overridden)
  SITE_MEMBERS: 'members', // Site Members can view (cascades to include members; guests: no)
  ANYONE: 'anyone', // Guests can view (cascades: guests + members get VIEW)
};

/** ---------------------------------------------
 *  Default action sets per asset & role
 *  (Based on your observed payloads and Liferay defaults)
 * ----------------------------------------------*/

// Owner is fixed & “full” for each asset type.
const OWNER_ACTIONS = {
  [ASSET_TYPE.DOCUMENT_FOLDER]: new Set([
    ACTION_IDS.DELETE,
    ACTION_IDS.PERMISSIONS,
    ACTION_IDS.ADD_SUBFOLDER,
    ACTION_IDS.ADD_SHORTCUT,
    ACTION_IDS.UPDATE,
    ACTION_IDS.VIEW,
    ACTION_IDS.ADD_DOCUMENT,
    ACTION_IDS.SUBSCRIBE,
    ACTION_IDS.ACCESS,
  ]),
  [ASSET_TYPE.DOCUMENT]: new Set([
    ACTION_IDS.UPDATE_DISCUSSION,
    ACTION_IDS.DELETE,
    ACTION_IDS.OVERRIDE_CHECKOUT,
    ACTION_IDS.PERMISSIONS,
    ACTION_IDS.DOWNLOAD,
    ACTION_IDS.DELETE_DISCUSSION,
    ACTION_IDS.UPDATE,
    ACTION_IDS.VIEW,
    ACTION_IDS.SUBSCRIBE,
    ACTION_IDS.ADD_DISCUSSION,
  ]),
};

// Baseline Non-Owner actions that are *not* controlled by Viewable By.
// (Everything else below is granted/removed via VIEWABLE_BY.)
const BASE_NON_OWNER = {
  [ASSET_TYPE.DOCUMENT_FOLDER]: {
    [ROLE.SITE_MEMBER]: new Set([
      ACTION_IDS.ADD_SUBFOLDER,
      ACTION_IDS.ADD_SHORTCUT,
      ACTION_IDS.ADD_DOCUMENT,
      ACTION_IDS.SUBSCRIBE,
      // VIEW is conditional via Viewable By
    ]),
    [ROLE.GUEST]: new Set([
      // VIEW is conditional via Viewable By; folders typically don't expose other guest actions by default
    ]),
  },

  [ASSET_TYPE.DOCUMENT]: {
    // Per your observation: all roles always have ADD_DISCUSSION
    [ROLE.SITE_MEMBER]: new Set([ACTION_IDS.ADD_DISCUSSION]),
    [ROLE.GUEST]: new Set([ACTION_IDS.ADD_DISCUSSION]),
  },
};

/** ---------------------------------------------
 *  Viewable By rules
 *  - Which roles get VIEW (and for Documents, DOWNLOAD) based on selection.
 *  - “Cascades”: ANYONE => Guest + Site Member; SITE_MEMBERS => Site Member only.
 * ----------------------------------------------*/

/**
 * Returns the set of actions granted by the selected Viewable By for a given asset & role.
 * Owner is *not* handled here (Owner always has the full fixed set).
 */
function viewableByGrants(assetType, viewableBy, roleName) {
  const grants = new Set();

  // Determine if this role should receive VIEW (and possibly DOWNLOAD).
  const grantSiteMembers =
    viewableBy === VIEWABLE_BY.SITE_MEMBERS ||
    viewableBy === VIEWABLE_BY.ANYONE;
  const grantGuests = viewableBy === VIEWABLE_BY.ANYONE;

  if (roleName === ROLE.SITE_MEMBER && grantSiteMembers) {
    grants.add(ACTION_IDS.VIEW);
    if (assetType === ASSET_TYPE.DOCUMENT) grants.add(ACTION_IDS.DOWNLOAD);
  }

  if (roleName === ROLE.GUEST && grantGuests) {
    grants.add(ACTION_IDS.VIEW);
    if (assetType === ASSET_TYPE.DOCUMENT) grants.add(ACTION_IDS.DOWNLOAD);
  }

  return grants;
}

/** ---------------------------------------------
 *  Core helpers
 * ----------------------------------------------*/

/**
 * Compute the action set for a single role given assetType & viewableBy.
 * @param {("document-folder"|"document")} assetType
 * @param {("owner"|"members"|"anyone")} viewableBy
 * @param {("Owner"|"Site Member"|"Guest"|"User")} roleName
 * @returns {Set<string>}
 */
function computeRoleActions(assetType, viewableBy, roleName) {
  if (roleName === ROLE.OWNER) {
    return new Set(OWNER_ACTIONS[assetType]); // copy
  }

  // Start with baseline non-owner actions (if defined)
  const base = new Set(BASE_NON_OWNER[assetType]?.[roleName] || []);

  // Grant VIEW/DOWNLOAD per Viewable By rules
  const grants = viewableByGrants(assetType, viewableBy, roleName);
  for (const a of grants) base.add(a);

  // (Optional) You can encode other per-asset invariants here if you discover them later.

  return base;
}

/**
 * Apply overrides for a role: { add?: string[], remove?: string[] }
 */
function mergeOverrides(currentSet, overrideObj) {
  if (!overrideObj) return new Set(currentSet);
  const next = new Set(currentSet);

  if (Array.isArray(overrideObj.add)) {
    for (const a of overrideObj.add) next.add(a);
  }
  if (Array.isArray(overrideObj.remove)) {
    for (const a of overrideObj.remove) next.delete(a);
  }
  return next;
}

/**
 * Build the `items` array expected by Liferay’s /permissions PUT.
 * @param {Object} params
 * @param {("document-folder"|"document")} params.assetType
 * @param {("owner"|"members"|"anyone")} params.viewableBy
 * @param {Object} [params.overrides] - Optional per-role overrides:
 *   {
 *     "Owner": { add:[], remove:[] },
 *     "Site Member": { add:[], remove:[] },
 *     "Guest": { add:[], remove:[] }
 *   }
 * @param {string[]} [params.includeRoles=[ROLE.OWNER, ROLE.GUEST, ROLE.SITE_MEMBER]]
 * @returns {{actionIds:string[], roleName:string}[]}
 */
function buildPermissionsItems({
  assetType,
  viewableBy,
  overrides = {},
  includeRoles = [ROLE.OWNER, ROLE.GUEST, ROLE.SITE_MEMBER],
}) {
  if (!ASSET_TYPE[assetType?.toUpperCase()?.replace('-', '_')]) {
    throw new Error(`Unknown assetType: ${assetType}`);
  }
  if (!Object.values(VIEWABLE_BY).includes(viewableBy)) {
    throw new Error(`Unknown viewableBy: ${viewableBy}`);
  }

  const items = [];

  for (const roleName of includeRoles) {
    const base = computeRoleActions(assetType, viewableBy, roleName);
    const finalSet = mergeOverrides(base, overrides[roleName]);

    // Liferay expects a stable array; sort for determinism.
    const actionIds = Array.from(finalSet).sort();

    // Skip empty (some users prefer to send all roles regardless; keep or remove based on your API behavior)
    items.push({ actionIds, roleName });
  }

  return items;
}

/** ---------------------------------------------
 *  Module Exports
 * ----------------------------------------------*/
module.exports = {
  ACTION_IDS,
  ROLE,
  ASSET_TYPE,
  VIEWABLE_BY,
  computeRoleActions,
  buildPermissionsItems,
  mergeOverrides,
};
