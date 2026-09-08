const fs = require('fs');
const path = require('path');
const {
  listPromptNames,
  listSchemaNames,
} = require('../utils/configurationAssets.cjs');

const PROMPTS_DIR = path.join(__dirname, '../prompts');
const SCHEMAS_DIR = path.join(__dirname, '../generation-schemas');

const SCALAR_TYPES = new Set(['boolean', 'integer', 'number']);

/**
 * Every property name in a generation schema whose declared type is numeric or
 * boolean, mapped to that type.
 *
 * Collected by name across the whole schema rather than by JSON pointer,
 * because a prompt describes the shape it wants in prose and gives no path to
 * match against. A name that is numeric in one place and a string in another
 * would be ambiguous; none currently is, and the test below reports it as a
 * conflict rather than guessing.
 */
function scalarProperties(node, found = new Map(), conflicts = new Set()) {
  if (Array.isArray(node)) {
    for (const entry of node) scalarProperties(entry, found, conflicts);
    return { conflicts, found };
  }

  if (!node || typeof node !== 'object') return { conflicts, found };

  if (node.properties && typeof node.properties === 'object') {
    for (const [name, child] of Object.entries(node.properties)) {
      if (!child || typeof child !== 'object') continue;

      const declared = Array.isArray(child.type) ? child.type : [child.type];
      const scalar = declared.find((type) => SCALAR_TYPES.has(type));

      if (scalar) {
        if (found.has(name) && found.get(name) !== scalar) conflicts.add(name);
        found.set(name, scalar);
      } else if (declared.includes('string')) {
        if (found.has(name)) conflicts.add(name);
      }
    }
  }

  for (const value of Object.values(node)) {
    scalarProperties(value, found, conflicts);
  }

  return { conflicts, found };
}

/**
 * Whether the prompt shows `"<name>":` followed by a quoted value.
 *
 * Scanned rather than matched with a RegExp built at runtime: the names come
 * from the schemas and would need escaping, and the intent reads more plainly
 * as a scan than as an expression assembled from data.
 */
function showsQuotedValue(prompt, name) {
  const key = `"${name}"`;

  const skipSpace = (index) => {
    let at = index;
    while (prompt.charAt(at) === ' ' || prompt.charAt(at) === '\t') at += 1;
    return at;
  };

  for (let from = 0; ;) {
    const at = prompt.indexOf(key, from);
    if (at === -1) return false;

    const colon = skipSpace(at + key.length);
    if (
      prompt.charAt(colon) === ':' &&
      prompt.charAt(skipSpace(colon + 1)) === '"'
    ) {
      return true;
    }

    from = at + key.length;
  }
}

function readAsset(dir, fileName) {
  // Both paths come from the directory listings above, not from input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(path.join(dir, fileName), 'utf8');
}

describe('Prompt and generation schema agree on field types', () => {
  // A prompt shows the model a JSON skeleton whose values are quoted
  // descriptions of what to put there. For a string field that is unambiguous.
  // For a numeric or boolean one it is indistinguishable from an instruction to
  // return a string - so a model that copies the shape it was shown fails ajv
  // and costs a retry, which is a second paid model call.
  //
  // Nothing else connects a prompt to the schema its response is validated
  // against, so the two drift silently, and the drift only shows on the prose
  // path taken when a provider cannot constrain output. That is the path
  // nobody watches. See #712.
  const entities = listPromptNames().filter((name) =>
    listSchemaNames().includes(name)
  );

  it.each(entities)(
    'shows every numeric and boolean field in %s unquoted',
    (entity) => {
      const schema = JSON.parse(readAsset(SCHEMAS_DIR, `${entity}.json`));
      const { conflicts, found } = scalarProperties(schema);
      const prompt = readAsset(PROMPTS_DIR, `${entity}.md`);

      const quoted = [...found.entries()]
        .filter(([name]) => !conflicts.has(name))
        .filter(([name]) => showsQuotedValue(prompt, name))
        .map(([name, type]) => `${name} (${type})`);

      expect(quoted).toEqual([]);
    }
  );

  it('has at least one numeric field to check, so the guard cannot pass vacuously', () => {
    const anyScalar = entities.some(
      (entity) =>
        scalarProperties(JSON.parse(readAsset(SCHEMAS_DIR, `${entity}.json`)))
          .found.size > 0
    );

    expect(anyScalar).toBe(true);
  });
});
