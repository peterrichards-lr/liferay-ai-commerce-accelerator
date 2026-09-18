/**
 * The prompt template engine.
 *
 * Prompts are content: an operator writes one and imports it through the
 * configuration UI, so anything a prompt cannot express has to be composed in
 * `utils/promptContext.cjs` by someone with commit access. That is why every
 * condition in a prompt was a code change (#655).
 *
 * nunjucks is Jinja2-compatible, which is the syntax the prompts were written
 * in before #643 removed it, and has no native dependencies.
 *
 * #643 is the reason the rest of this file is shaped the way it is. Prompts
 * were written against a renderer that understood two regular expressions, so
 * `{% if %}` reached the model verbatim, both branches of every conditional
 * fired at once, and `You MUST categorize these products using the following
 * vocabularies` went out with nothing after it. Nothing downstream inspects a
 * prompt, so it surfaced only as a model returning the wrong shape. Reversing
 * that change means an engine now reads the same files, and every difference
 * of opinion it has about whitespace, escaping, undefined values or `{` is the
 * same class of fault in the other direction. Three rules follow:
 *
 * 1. `autoescape: false`. These are prompts, not HTML. Escaping would turn
 *    every ampersand in a product name into `&amp;` in the text a paid model
 *    reads.
 * 2. Undefined stays empty rather than throwing, which is what the prompts
 *    already rely on - `{{brandName}}` with no brand is an empty string, not
 *    an error.
 * 3. A template that will not compile or will not render must not fail a
 *    generation. It falls back to the pre-#655 substitution, which is exactly
 *    what the prompt would have rendered to yesterday, and logs loudly with
 *    the prompt name.
 *
 * `tests/promptRendering.test.cjs` holds the committed output of every prompt
 * in `prompts/` under the old renderer and compares it byte for byte.
 */

const nunjucks = require('nunjucks');

/**
 * `{{=json:var}}` is ours and predates all of this. Rewriting it to a filter
 * before the engine sees it is the only preprocessing performed: substituting
 * the JSON itself here would splice model-derived text into the template
 * source, where a product description containing `{{` or `{%` would be read as
 * markup. Through a filter the value is inserted after parsing and can never
 * be interpreted.
 */
const LEGACY_JSON_PLACEHOLDER = /\{\{=json:([\w.[\]]+)\}\}/g;

const LEGACY_PLACEHOLDER = /\{\{([\w.[\]]+)\}\}/g;

/**
 * nunjucks has no `while`, so the only unbounded construct a prompt author can
 * reach is a `for` over a generated sequence. A run of a few thousand is more
 * than any prompt needs and an order of magnitude below the point where the
 * rendered string becomes the problem.
 */
const RANGE_LIMIT = 10000;

function lookup(vars, path) {
  return path
    .split('.')
    .reduce(
      (value, key) => (value && value[key] !== undefined ? value[key] : ''),
      vars
    );
}

function jsonValue(value) {
  try {
    // Undefined is empty string rather than nothing, because that is what the
    // pre-#655 renderer stringified for a variable it could not resolve and
    // several prompts read as `Available Products: ""`.
    return JSON.stringify(value === undefined ? '' : value);
  } catch {
    return 'null';
  }
}

/**
 * The renderer as it behaved before #655, kept as the fallback for a template
 * the engine rejects. It is deliberately the same two substitutions: a prompt
 * that fails to compile still reaches the model as the text it would have
 * reached it as yesterday, rather than not at all.
 */
function substitute(template, vars) {
  return String(template || '')
    .replace(LEGACY_JSON_PLACEHOLDER, (_match, path) =>
      jsonValue(lookup(vars, path))
    )
    .replace(LEGACY_PLACEHOLDER, (_match, path) => {
      const value = lookup(vars, path);

      // null renders empty, as nunjucks renders it, so a template that falls
      // back does not quietly write the word "null" into the prompt where the
      // engine would have written nothing.
      return value === null ? '' : String(value);
    });
}

/**
 * An optional block that resolves to nothing leaves its blank line behind, and
 * several in a row open a gap in the prompt. Added in #643 and kept: a
 * conditional whose branch is not taken has exactly the same shape.
 */
function collapseBlankLines(text) {
  return text.replace(/\n{3,}/g, '\n\n');
}

function boundedRange(start, stop, step) {
  const from = stop === undefined ? 0 : Number(start);
  const to = stop === undefined ? Number(start) : Number(stop);
  const by = Number(step) || 1;

  const length = Math.max(0, Math.ceil((to - from) / by));

  if (length > RANGE_LIMIT) {
    throw new Error(
      `range(${from}, ${to}, ${by}) asks for ${length} iterations; the limit is ${RANGE_LIMIT}`
    );
  }

  const values = [];

  for (let value = from; by > 0 ? value < to : value > to; value += by) {
    values.push(value);
  }

  return values;
}

/**
 * Jinja2's `map`, which nunjucks 3.2.4 does not ship - it has `selectattr` and
 * `rejectattr` but nothing to project with, so
 * `{{ languages | map(attribute='id') | join(', ') }}` - the expression the
 * prompts were written with - would fail to render.
 *
 * Both Jinja2 forms are supported: `map(attribute='id')` plucks, and
 * `map('upper')` applies a named filter. Keyword arguments arrive as a
 * trailing object flagged `__keywords`.
 */
function mapFilter(environment) {
  return function map(sequence, ...args) {
    const items = Array.isArray(sequence) ? sequence : [];
    const last = args[args.length - 1];
    const keywords = last && last.__keywords ? last : null;
    const positional = keywords ? args.slice(0, -1) : args;

    if (keywords?.attribute) {
      return items.map((item) => lookup(item, String(keywords.attribute)));
    }

    if (positional.length > 0) {
      const filter = environment.getFilter(String(positional[0]));

      return items.map((item) =>
        filter.call(this, item, ...positional.slice(1))
      );
    }

    return items;
  };
}

function createEnvironment() {
  // An empty loader array rather than none: nunjucks defaults to a filesystem
  // loader rooted at `views`, and a prompt is imported content, so `{% include
  // %}` must not be able to read a file off the server at all. With no loader
  // it fails to render, which the caller turns into the fallback.
  const environment = new nunjucks.Environment([], {
    autoescape: false,
    // A block tag on its own line contributes no newline of its own, so an
    // `{% if %}` reads in the rendered prompt the way it reads in the file.
    lstripBlocks: true,
    throwOnUndefined: false,
    trimBlocks: true,
  });

  environment.addFilter('json', jsonValue);
  environment.addFilter('map', mapFilter(environment));
  environment.addGlobal('range', boundedRange);

  return environment;
}

const environment = createEnvironment();

/**
 * @param {string} template the prompt source
 * @param {object} vars the variables the prompt is rendered against
 * @param {{ logger?: object, name?: string }} [options]
 * @returns {string} the text sent to the model
 */
function renderTemplate(template, vars = {}, { logger, name } = {}) {
  const source = String(template || '').replace(
    LEGACY_JSON_PLACEHOLDER,
    '{{ $1 | json }}'
  );

  try {
    const compiled = new nunjucks.Template(
      source,
      environment,
      name || 'prompt',
      true
    );

    return collapseBlankLines(compiled.render(vars));
  } catch (error) {
    // A prompt is admin-authored content and a typo in one must not stop a
    // generation that is already running. It is logged rather than swallowed,
    // because the degraded prompt is what the model then answers.
    logger?.error?.('Prompt template failed to render; using substitution', {
      message: error?.message,
      name: name || 'prompt',
    });

    return collapseBlankLines(substitute(template, vars));
  }
}

module.exports = { collapseBlankLines, renderTemplate, substitute };
