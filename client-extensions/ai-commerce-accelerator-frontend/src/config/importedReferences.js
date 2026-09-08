/**
 * Resolving an imported catalog or channel against the connected instance.
 *
 * An exported configuration carries both the id and the name of the entity it
 * was pointing at. The id is only meaningful on the instance it came from - a
 * rebuilt bundle, a colleague's instance, or the same instance after a database
 * reset all hand the same id to something unrelated - so the name travels with
 * it as the portable half of the reference. See #656.
 *
 * The id is still tried first: it is exact, and two entities may share a name.
 * The name is the fallback, and a fallback is always reported to the user,
 * because the failure this replaces was a silent one.
 */

export const RESOLVED_BY_ID = 'id';
export const RESOLVED_BY_NAME = 'name';
export const NOTHING_REQUESTED = 'not-requested';
export const NOTHING_TO_MATCH = 'no-list-loaded';
export const UNRESOLVED = 'unresolved';

const sameId = (candidate, id) => String(candidate?.id) === String(id);

const comparableName = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const requested = (value) =>
  value !== null && value !== undefined && String(value).trim() !== '';

/**
 * Matches an imported `{ id, name }` pair against a loaded list.
 *
 * Returns `{ outcome, item }`, where `item` is the matched entry and `outcome`
 * is one of the exported constants. An empty list yields NOTHING_TO_MATCH
 * rather than UNRESOLVED: nothing has been loaded to match against, so the
 * import cannot conclude the reference is dead.
 */
export function resolveImportedReference({ items, id, name }) {
  if (!requested(id) && !requested(name)) {
    return { item: null, outcome: NOTHING_REQUESTED };
  }

  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return { item: null, outcome: NOTHING_TO_MATCH };
  }

  if (requested(id)) {
    const byId = list.find((candidate) => sameId(candidate, id));
    if (byId) return { item: byId, outcome: RESOLVED_BY_ID };
  }

  if (requested(name)) {
    const wanted = comparableName(name);
    const byName = list.find(
      (candidate) => comparableName(candidate?.name) === wanted
    );
    if (byName) return { item: byName, outcome: RESOLVED_BY_NAME };
  }

  return { item: null, outcome: UNRESOLVED };
}

const describeRequest = (id, name) => {
  if (requested(id) && requested(name)) return `'${name}' (id ${id})`;
  if (requested(name)) return `'${name}'`;
  return `id ${id}`;
};

/**
 * The toast for a resolution, or null when there is nothing worth saying.
 *
 * A match on the id is the ordinary case and stays quiet. Everything else is
 * announced: the point of the exercise is that an id which no longer means what
 * it did is never applied, or dropped, without the user hearing about it.
 */
export function describeResolution({ label, outcome, item, id, name }) {
  switch (outcome) {
    case RESOLVED_BY_NAME:
      return {
        message: `${label} id ${id} does not exist here. Matched '${item.name}' by name instead, now id ${item.id}.`,
        type: 'warning',
      };

    case NOTHING_TO_MATCH:
      return {
        message: `${label} ${describeRequest(
          id,
          name
        )} could not be checked because no ${label.toLowerCase()} list is loaded. Test the connection to confirm the selection.`,
        type: 'warning',
      };

    case UNRESOLVED:
      return {
        message: `${label} ${describeRequest(
          id,
          name
        )} was not found on this instance. The selection has been cleared - check it before generating.`,
        type: 'warning',
      };

    default:
      return null;
  }
}
