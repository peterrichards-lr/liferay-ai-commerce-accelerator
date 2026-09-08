/**
 * Guards the two lists that decide whether an operator's choice reaches the
 * generators at all.
 *
 * `buildConfigAndOptions` is an explicit-destructure whitelist: a field the
 * caller sends that is not named there is dropped with no error and no warning.
 * That is the right posture for a request body that also carries credentials -
 * the alternative is copying arbitrary caller input into a persisted session
 * context - but a whitelist is only safe while something notices when it falls
 * behind the form in front of it. Four fields had fallen behind by the time
 * #696 was raised, and #647 had already spent time on the same shape.
 *
 * So the whitelist stays, and these tests are what fail the build when it drifts:
 *
 *  1. Every field the dashboard sends survives normalisation. `buildPayload`
 *     in App.jsx spreads `generationConfig` wholesale, so the keys of
 *     `initialGenerationConfig` are exactly what the microservice is sent.
 *  2. Every field the request schemas declare survives normalisation. This
 *     covers callers that are not the dashboard - the CLI, the MCP tool, a
 *     direct API client - and is the one that catches an input we validate and
 *     then throw away.
 *
 * Both are presence checks. Whether a carried value is coerced correctly is the
 * business of normalize.test.cjs; whether it is carried at all is this file's.
 */
const fs = require('fs');
const path = require('path');
const { buildConfigAndOptions } = require('../utils/normalize.cjs');
const {
  generateAccountsSchema,
  generateDataSchema,
  generateOrdersSchema,
} = require('../utils/schemas.cjs');

const APP_JSX = path.join(
  __dirname,
  '../../ai-commerce-accelerator-frontend/src/App.jsx'
);

/**
 * The names of the fields the dashboard's generation form sends.
 *
 * Only the names: the guard asks whether a field survives normalisation, not
 * what its default happens to be, so each is given the same benign value below
 * rather than its literal default. That keeps this out of the business of
 * parsing JavaScript values, and leaves nothing to evaluate.
 *
 * Anchored to two-space indentation, which is the top level of the object under
 * prettier. `orderDistribution` is written inline, so its inner keys sit on the
 * same line and are correctly not matched.
 */
function dashboardGenerationFields() {
  const source = fs.readFileSync(APP_JSX, 'utf8');
  const start = source.indexOf('const initialGenerationConfig = {');

  expect(
    start,
    'initialGenerationConfig was renamed or moved in App.jsx; this guard needs updating'
  ).toBeGreaterThan(-1);

  const literal = source.slice(start, source.indexOf('\n};', start));

  return [...literal.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map(
    ([, field]) => field
  );
}

/**
 * A value every coercion in normalize.cjs accepts, so presence is the only
 * thing under test. The multipart path makes every field a string in any case.
 */
const SUPPLIED = '1';

/**
 * Fields the dashboard sends that deliberately do not become options.
 *
 * Empty on purpose: nothing the form currently sends has a reason not to be
 * carried. It exists so that a field which genuinely cannot be - the way the
 * two custom media files are read from `req.files` by multer rather than from
 * `req.body` - is excused in writing rather than by deleting an assertion.
 */
const NOT_CARRIED_AS_OPTIONS = {};

const VALIDATION_CONTEXT = {
  aiModelOptions: [{ value: 'gpt-4o' }],
  batchSizes: [10],
  limits: { maxProducts: 1000, maxAccounts: 1000, maxOrders: 1000 },
};

/**
 * A value the rule would accept, so the field is present when normalisation
 * runs.
 */
function sampleForRule(rule) {
  if (Array.isArray(rule.enum) && rule.enum.length > 0) return rule.enum[0];
  if (rule.type === 'number') {
    return typeof rule.min === 'number' ? rule.min + 1 : 1;
  }
  if (rule.type === 'boolean') return true;
  if (rule.type === 'array') return [1];
  if (rule.type === 'object') return { open: 100 };
  if (rule.pattern) return 'http://localhost:8080';
  return 'sample';
}

function normalise(body) {
  return buildConfigAndOptions({
    headers: {},
    body: {
      liferayUrl: 'http://localhost:8080',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      ...body,
    },
  });
}

function carriedKeys({ config, options }) {
  const defined = (source) =>
    Object.entries(source)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);

  return new Set([...defined(config), ...defined(options)]);
}

describe('Every option the dashboard sends survives normalisation', () => {
  const fields = dashboardGenerationFields();
  const body = Object.fromEntries(fields.map((field) => [field, SUPPLIED]));

  it('reads the form fields out of App.jsx', () => {
    // A guard that silently found nothing to check would pass forever.
    expect(fields.length).toBeGreaterThan(20);
    expect(fields).toEqual(expect.arrayContaining(['orderDistribution']));
    // An inner key of the inline orderDistribution literal; matching it would
    // mean the anchoring has come adrift.
    expect(fields).not.toEqual(expect.arrayContaining(['processing']));
  });

  it.each(fields.filter((field) => !(field in NOT_CARRIED_AS_OPTIONS)))(
    'carries %s into config or options',
    (field) => {
      const carried = carriedKeys(normalise(body));

      expect(
        carried.has(field),
        `The dashboard sends "${field}" and buildConfigAndOptions drops it. ` +
          'Destructure it in utils/normalize.cjs and assign it, or add it to ' +
          'NOT_CARRIED_AS_OPTIONS with the reason it cannot be carried.'
      ).toBe(true);
    }
  );

  it('excuses only fields the form still sends, and says why', () => {
    Object.entries(NOT_CARRIED_AS_OPTIONS).forEach(([field, reason]) => {
      expect(
        fields,
        `${field} is excused but the form no longer sends it`
      ).toEqual(expect.arrayContaining([field]));
      expect(reason.length).toBeGreaterThan(10);
    });
  });
});

describe('Every option the request schemas declare survives normalisation', () => {
  const schemas = {
    data: generateDataSchema,
    orders: generateOrdersSchema,
    accounts: generateAccountsSchema,
  };

  Object.entries(schemas).forEach(([flow, buildSchema]) => {
    const schema = buildSchema(
      VALIDATION_CONTEXT.aiModelOptions,
      VALIDATION_CONTEXT.batchSizes,
      VALIDATION_CONTEXT.limits
    );
    const body = Object.fromEntries(
      Object.entries(schema).map(([field, rule]) => [
        field,
        sampleForRule(rule),
      ])
    );

    it.each(Object.keys(schema))(
      `carries %s, declared by the ${flow} schema`,
      (field) => {
        const carried = carriedKeys(normalise(body));

        expect(
          carried.has(field),
          `The ${flow} request schema declares "${field}" as an accepted ` +
            'input and buildConfigAndOptions drops it, so it is validated and ' +
            'then thrown away. Destructure and assign it in utils/normalize.cjs.'
        ).toBe(true);
      }
    );
  });
});
