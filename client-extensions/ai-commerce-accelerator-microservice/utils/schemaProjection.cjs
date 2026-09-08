/**
 * Derives a provider-acceptable JSON schema from a generation schema so the
 * model's output can be constrained by shape rather than merely asked to parse.
 *
 * `json_object` and `responseMimeType: 'application/json'` guarantee only that
 * the response is JSON. Nothing stopped a model nesting an entire product body
 * inside `description`, a locale-to-string map, which it did eighteen times in
 * one log. See #633.
 *
 * The generation-schemas are the authoritative ajv gate and are left untouched:
 * they legitimately need `minimum`/`maximum` and open locale maps, and rewriting
 * them to suit one provider's structured-output subset would weaken the
 * validation that catches bad data. So the schema sent to the provider is
 * projected from them at call time instead.
 *
 * Two things make that possible. Locale maps are open only because the locales
 * are a runtime choice - they are known at the call site from
 * `selectedLanguages`, so they can be written out as named properties. And the
 * value constraints each provider rejects are not lost by being dropped here,
 * because ajv still validates the response afterwards and
 * GenerationFacade retries with the errors fed back. Structured output narrows
 * the shape; ajv keeps enforcing the values.
 */

/**
 * Open string maps that are keyed by language code, and so can be expanded.
 *
 * Matched by property name because the source schemas carry no marker for it,
 * and an unrecognised name is left open rather than guessed at: expanding a map
 * that is not locale-keyed would silently rewrite it into the wrong shape.
 * `skuVariants[].options` is keyed by option name - names the model invents in
 * the same response - and is the one open map that cannot be expanded.
 * tests/schemaProjection.test.cjs asserts that every open map in every
 * generation schema is either in this set or is that one, so a new one cannot
 * appear unnoticed.
 */
const LOCALE_KEYED_PROPERTIES = new Set([
  'category',
  'description',
  'label',
  'metaDescription',
  'metaKeyword',
  'metaTitle',
  'name',
  'shortDescription',
  'title',
  'urls',
  'value',
]);

const NUMERIC_KEYWORDS = [
  'exclusiveMaximum',
  'exclusiveMinimum',
  'maximum',
  'minimum',
  'multipleOf',
];

const OPENAI_FORMATS = new Set([
  'date',
  'date-time',
  'duration',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'time',
  'uuid',
]);

// Anthropic documents the same list plus `uri`; OpenAI's does not include it,
// and account.json uses `format: "uri"`.
const ANTHROPIC_FORMATS = new Set([...OPENAI_FORMATS, 'uri']);

// The installed @google/generative-ai SDK types a string schema's format as
// `"date-time"` or the `"enum"` marker below, and nothing else.
const GEMINI_FORMATS = new Set(['date-time']);

const PROFILES = {
  anthropic: {
    arrayItemBounds: 'zeroOrOne',
    closeObjects: true,
    formats: ANTHROPIC_FORMATS,
    keepNumericBounds: false,
    keepPattern: false,
    nullStyle: 'anyOf',
    requireEveryProperty: false,
  },
  gemini: {
    arrayItemBounds: 'all',
    closeObjects: false,
    enumNeedsFormatMarker: true,
    formats: GEMINI_FORMATS,
    keepNumericBounds: false,
    keepPattern: false,
    nullStyle: 'nullable',
    requireEveryProperty: false,
    singleType: true,
  },
  openai: {
    arrayItemBounds: 'all',
    closeObjects: true,
    formats: OPENAI_FORMATS,
    keepNumericBounds: true,
    keepPattern: true,
    nullStyle: 'union',
    // Strict mode rejects a schema whose `properties` are not all listed in
    // `required`; the documented way to keep a field optional is a union with
    // null, which the model then returns as null and
    // GenerationFacade.validateAndNormalize drops before revalidating.
    requireEveryProperty: true,
  },
};

function localeCodes(languages) {
  const requested =
    Array.isArray(languages) && languages.length ? languages : ['en-US'];

  const codes = [
    ...new Set(
      requested
        .map((language) => String(language || '').replace(/-/g, '_'))
        .filter(Boolean)
    ),
  ];

  return codes.length ? codes : ['en_US'];
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function typeList(node) {
  if (Array.isArray(node.type)) return node.type.filter(Boolean);
  return node.type ? [node.type] : [];
}

function looksLikeObject(node) {
  return (
    typeList(node).includes('object') ||
    isPlainObject(node.properties) ||
    isPlainObject(node.additionalProperties)
  );
}

function looksLikeArray(node) {
  return typeList(node).includes('array') || isPlainObject(node.items);
}

/**
 * An object whose keys are not described at all, or an array of them.
 *
 * `account.json` has two: `postalAddresses`, declared as
 * `items: { type: 'object' }`. No provider can express "any object", but
 * neither can a model usefully fill one - the prompt does not ask for it and
 * AccountGenerator deletes whatever arrives before rebuilding the addresses
 * itself. Where such a property is optional it is left out of the projection
 * altogether, which is what the pipeline already assumes.
 */
function isUnspecified(node) {
  if (!isPlainObject(node)) return true;

  if (
    Array.isArray(node.enum) ||
    typeof node.const !== 'undefined' ||
    Array.isArray(node.anyOf) ||
    Array.isArray(node.allOf)
  ) {
    return false;
  }

  if (looksLikeArray(node)) {
    return isUnspecified(node.items);
  }

  const types = typeList(node);
  const objectShaped = !types.length || types.includes('object');

  return (
    objectShaped &&
    !isPlainObject(node.properties) &&
    !isPlainObject(node.additionalProperties)
  );
}

/**
 * Applies the profile's way of saying "or null" to an already-projected node.
 */
function allowNull(projected, profile) {
  if (profile.nullStyle === 'nullable') {
    return { ...projected, nullable: true };
  }

  if (profile.nullStyle === 'anyOf') {
    if (Array.isArray(projected.anyOf)) {
      return {
        ...projected,
        anyOf: [...projected.anyOf, { type: 'null' }],
      };
    }
    const { description, ...rest } = projected;
    const branch = { anyOf: [rest, { type: 'null' }] };
    return description ? { description, ...branch } : branch;
  }

  const types = typeList(projected);
  if (!types.length) return projected;

  return {
    ...projected,
    type: types.includes('null') ? types : [...types, 'null'],
  };
}

/**
 * Sets the node's non-null type and reports whether the source allowed null,
 * leaving how to say "or null" to allowNull and the profile.
 */
function projectType(node, profile, out) {
  const types = typeList(node);
  if (!types.length) return false;

  const concrete = types.filter((type) => type !== 'null');

  if (concrete.length) {
    out.type =
      concrete.length === 1 || profile.singleType ? concrete[0] : concrete;
  }

  return types.length !== concrete.length;
}

function projectConstraints(node, profile, out) {
  if (Array.isArray(node.enum)) {
    // Gemini's schema types an enum only on a string, and only alongside the
    // `format: 'enum'` marker; a numeric one has nowhere to go.
    if (profile.enumNeedsFormatMarker) {
      if (out.type === 'string') {
        out.enum = node.enum;
        out.format = 'enum';
      }
    } else {
      out.enum = node.enum;
    }
  }

  if (typeof node.const !== 'undefined' && !profile.singleType) {
    out.const = node.const;
  }

  if (profile.keepNumericBounds) {
    Object.assign(
      out,
      Object.fromEntries(
        Object.entries(node).filter(
          ([keyword, value]) =>
            NUMERIC_KEYWORDS.includes(keyword) && typeof value === 'number'
        )
      )
    );
  }

  if (profile.keepPattern && typeof node.pattern === 'string') {
    out.pattern = node.pattern;
  }

  if (
    typeof node.format === 'string' &&
    profile.formats.has(node.format) &&
    out.format !== 'enum'
  ) {
    out.format = node.format;
  }
}

function projectArrayBounds(node, profile, out) {
  if (profile.arrayItemBounds === 'all') {
    if (typeof node.minItems === 'number') out.minItems = node.minItems;
    if (typeof node.maxItems === 'number') out.maxItems = node.maxItems;
    return;
  }

  // Anthropic accepts minItems only as 0 or 1, and no maxItems.
  if (node.minItems === 0 || node.minItems === 1) {
    out.minItems = node.minItems;
  }
}

function closeObject(out, profile, required) {
  out.type = 'object';

  if (required.length) {
    out.required = required;
  }

  if (profile.closeObjects) {
    out.additionalProperties = false;
  }

  return out;
}

function projectObject(node, name, pointer, context) {
  const { profile } = context;
  const out = {};
  if (typeof node.description === 'string') out.description = node.description;

  const properties = isPlainObject(node.properties) ? node.properties : null;
  const openValues = isPlainObject(node.additionalProperties)
    ? node.additionalProperties
    : null;

  if (openValues && !properties) {
    if (LOCALE_KEYED_PROPERTIES.has(name)) {
      out.properties = Object.fromEntries(
        context.locales.map((locale) => [
          locale,
          projectNode(
            openValues,
            locale,
            `${pointer}/${locale}`,
            true,
            context
          ),
        ])
      );
      return closeObject(out, profile, [...context.locales]);
    }

    context.blockers.push(pointer);

    if (context.mode === 'advisory') {
      out.type = 'object';
      out.additionalProperties = projectNode(
        openValues,
        name,
        `${pointer}/*`,
        true,
        context
      );
      return out;
    }

    return closeObject(out, profile, []);
  }

  if (!properties) {
    // An object with neither declared properties nor a value schema cannot be
    // expressed: every provider here requires the keys to be enumerated.
    context.blockers.push(pointer);
    return closeObject(out, profile, []);
  }

  const sourceRequired = Array.isArray(node.required) ? node.required : [];
  const projected = [];
  const required = [];

  for (const [key, child] of Object.entries(properties)) {
    const childRequired = sourceRequired.includes(key);
    const childPointer = `${pointer}/${key}`;

    if (!childRequired && isUnspecified(child)) {
      context.omitted.push(childPointer);
      continue;
    }

    projected.push([
      key,
      projectNode(child, key, childPointer, childRequired, context),
    ]);

    if (childRequired || profile.requireEveryProperty) {
      required.push(key);
    }
  }

  if (!projected.length) {
    context.blockers.push(pointer);
    return closeObject(out, profile, []);
  }

  out.properties = Object.fromEntries(projected);
  return closeObject(out, profile, required);
}

function projectNode(node, name, pointer, required, context) {
  const { profile } = context;

  if (!isPlainObject(node)) return {};

  if (looksLikeObject(node)) {
    const projected = projectObject(node, name, pointer, context);
    return required || !profile.requireEveryProperty
      ? projected
      : allowNull(projected, profile);
  }

  const out = {};
  if (typeof node.description === 'string') out.description = node.description;

  const sourceNullable = projectType(node, profile, out);
  projectConstraints(node, profile, out);

  if (looksLikeArray(node)) {
    out.type = 'array';
    out.items = projectNode(
      node.items,
      name,
      `${pointer}/items`,
      true,
      context
    );
    projectArrayBounds(node, profile, out);
  }

  const needsNull =
    sourceNullable || (!required && profile.requireEveryProperty);

  return needsNull ? allowNull(out, profile) : out;
}

/**
 * Projects a generation schema for one provider.
 *
 * `mode: 'enforced'` produces a schema the provider will enforce, and returns
 * `schema: null` with the offending pointers in `blockers` when the source
 * cannot be expressed in that provider's subset. `mode: 'advisory'` never
 * blocks: it expands the locale maps and drops the rejected keywords but leaves
 * an inexpressible map open, for the one provider that has a channel for a
 * schema it does not promise to enforce.
 *
 * @param {object} source - A generation-schemas entry, unmodified.
 * @param {object} options
 * @param {string} options.provider - 'openai', 'anthropic' or 'gemini'.
 * @param {string[]} [options.languages] - The run's selectedLanguages.
 * @param {'enforced'|'advisory'} [options.mode]
 * @returns {{schema: object|null, blockers: string[]}}
 */
function projectGenerationSchema(source, options = {}) {
  const profile = PROFILES[String(options.provider || '').toLowerCase()];

  if (!profile) {
    return {
      blockers: [`unsupported provider: ${options.provider}`],
      omitted: [],
      schema: null,
    };
  }

  if (!isPlainObject(source)) {
    return {
      blockers: ['schema is not an object'],
      omitted: [],
      schema: null,
    };
  }

  const mode = options.mode === 'advisory' ? 'advisory' : 'enforced';

  const context = {
    blockers: [],
    locales: localeCodes(options.languages),
    mode,
    omitted: [],
    // Nothing enforces an advisory schema, so forcing every property into
    // `required` there would only push the model to emit nulls it was never
    // asked for. Objects still close, because that is the hint that stops a
    // whole product body being nested inside a locale map.
    profile:
      mode === 'advisory'
        ? { ...profile, requireEveryProperty: false }
        : profile,
  };

  const schema = projectNode(source, '', '', true, context);

  // A root with nothing declared under it constrains nothing, whichever mode
  // asked for it, so there is no point sending it.
  const unusable =
    !isPlainObject(schema.properties) ||
    (context.mode === 'enforced' && context.blockers.length > 0);

  return {
    blockers: context.blockers,
    omitted: context.omitted,
    schema: unusable ? null : schema,
  };
}

/**
 * The source schema with its locale maps written out as named properties, for
 * the prompt to describe when structured output is unavailable.
 *
 * Nothing else is changed, so every value constraint the model was told about
 * before is still there. What changes is the one thing the model misread: an
 * `additionalProperties: { type: 'string' }` map reads as "an object, contents
 * unspecified", which is how an entire product body came to be nested inside
 * `description`. Written out, the only keys it may have are named.
 */
function expandLocaleMapsForPrompt(source, languages) {
  const locales = localeCodes(languages);

  const rewrite = (node, name) => {
    if (Array.isArray(node)) return node.map((entry) => rewrite(entry, name));
    if (!isPlainObject(node)) return node;

    if (
      isPlainObject(node.additionalProperties) &&
      !isPlainObject(node.properties) &&
      LOCALE_KEYED_PROPERTIES.has(name)
    ) {
      const {
        additionalProperties,
        minProperties: _minProperties,
        ...rest
      } = node;

      return {
        ...rest,
        additionalProperties: false,
        properties: Object.fromEntries(
          locales.map((locale) => [locale, additionalProperties])
        ),
        required: [...locales],
        type: 'object',
      };
    }

    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, rewrite(value, key)])
    );
  };

  return rewrite(source, '');
}

/**
 * Whether a provider error is the provider rejecting the schema rather than
 * anything about the generation.
 *
 * Capability is checked where it can be, but the model list is shared across
 * providers and editable by an administrator, so an unenforceable pairing can
 * still reach the call. This lets it degrade to the prose path instead of
 * ending the run.
 */
const SCHEMA_REJECTION_STATUSES = new Set([400, 404, 422]);

function looksLikeSchemaRejection(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;

  // A status is required, so only the provider's own reply can trigger the
  // fallback. Without it, a locally thrown error whose wording happens to
  // mention the schema - "generation failed schema validation" - would cost a
  // pointless second call.
  if (!SCHEMA_REJECTION_STATUSES.has(status)) {
    return false;
  }

  const message = String(error?.message || '').toLowerCase();

  return [
    'additionalproperties',
    'json_schema',
    'output_config',
    'output_format',
    'response_format',
    'responseschema',
    'schema',
    'structured output',
  ].some((marker) => message.includes(marker));
}

module.exports = {
  LOCALE_KEYED_PROPERTIES,
  expandLocaleMapsForPrompt,
  looksLikeSchemaRejection,
  projectGenerationSchema,
};
