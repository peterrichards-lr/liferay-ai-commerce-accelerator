const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');
const { GenerationFacade } = require('../services/generationFacade.cjs');
const {
  LOCALE_KEYED_PROPERTIES,
  expandLocaleMapsForPrompt,
  looksLikeSchemaRejection,
  projectGenerationSchema,
} = require('../utils/schemaProjection.cjs');

const SCHEMAS_DIR = path.join(__dirname, '../generation-schemas');

const ENTITIES = fs
  .readdirSync(SCHEMAS_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => path.basename(file, '.json'));

function sourceSchema(entity) {
  // Read fresh each time so a test that mutates what it is given cannot leak
  // into another. The path comes from the directory listing above, not input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const contents = fs.readFileSync(
    path.join(SCHEMAS_DIR, `${entity}.json`),
    'utf8'
  );

  return JSON.parse(contents);
}

const LANGUAGES = ['en-US', 'es-ES'];

/**
 * Every schema node in a projected schema, so a rule can be asserted over all
 * of them. Only schema positions are followed - a data property called `items`
 * or `properties` would otherwise be mistaken for one.
 */
function nodes(schema) {
  const found = [];

  const walk = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;

    found.push(node);

    for (const child of Object.values(node.properties || {})) walk(child);
    for (const branch of node.anyOf || []) walk(branch);
    walk(node.items);

    if (typeof node.additionalProperties === 'object') {
      walk(node.additionalProperties);
    }
  };

  walk(schema);
  return found;
}

function objectNodes(schema) {
  return nodes(schema).filter(
    (node) => node.properties && typeof node.properties === 'object'
  );
}

describe('schemaProjection', () => {
  describe('locale expansion', () => {
    it('writes the selected languages out as named properties', () => {
      const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
        languages: LANGUAGES,
        provider: 'openai',
      });

      const name = schema.properties.warehouses.items.properties.name;

      expect(Object.keys(name.properties)).toEqual(['en_US', 'es_ES']);
      expect(name.required).toEqual(['en_US', 'es_ES']);
      expect(name.additionalProperties).toBe(false);
      expect(name.properties.en_US).toEqual({ type: 'string' });
    });

    it('closes the map that a whole product body was nested inside', () => {
      const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
        languages: ['en-US'],
        provider: 'openai',
      });

      const description =
        schema.properties.warehouses.items.properties.description;

      // The reported failure: `description` accepted an object of unspecified
      // contents, so the model put the entire entity inside it. See #633.
      expect(description.additionalProperties).toBe(false);
      expect(Object.keys(description.properties)).toEqual(['en_US']);
    });

    it('normalises language tags to Liferay locale keys and drops duplicates', () => {
      const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
        languages: ['en-US', 'en_US', 'fr-FR'],
        provider: 'openai',
      });

      expect(
        Object.keys(
          schema.properties.warehouses.items.properties.name.properties
        )
      ).toEqual(['en_US', 'fr_FR']);
    });

    it('defaults to en_US when the caller passes no languages', () => {
      const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
        provider: 'openai',
      });

      expect(
        Object.keys(
          schema.properties.warehouses.items.properties.name.properties
        )
      ).toEqual(['en_US']);
    });

    it('leaves a map that is not keyed by language alone, and blocks on it', () => {
      const result = projectGenerationSchema(sourceSchema('product'), {
        languages: LANGUAGES,
        provider: 'openai',
      });

      // skuVariants[].options is keyed by option name - names the model invents
      // in the same response - so its keys cannot be written out.
      expect(result.schema).toBeNull();
      expect(result.blockers).toEqual([
        '/products/items/skuVariants/items/options',
      ]);
    });
  });

  describe('per-provider keyword handling', () => {
    it('keeps the numeric bounds OpenAI supports', () => {
      const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
        provider: 'openai',
      });

      expect(schema.properties.warehouses.items.properties.latitude).toEqual({
        description: "The latitude of the warehouse's location.",
        maximum: 90,
        minimum: -90,
        type: 'number',
      });
    });

    it('drops the numeric bounds Anthropic rejects', () => {
      const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
        provider: 'anthropic',
      });

      const latitude = schema.properties.warehouses.items.properties.latitude;

      expect(latitude.minimum).toBeUndefined();
      expect(latitude.maximum).toBeUndefined();
      expect(latitude.type).toBe('number');
    });

    it('drops the numeric bounds Gemini rejects', () => {
      const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
        provider: 'gemini',
      });

      const latitude = schema.properties.warehouses.items.properties.latitude;

      expect(latitude.minimum).toBeUndefined();
      expect(latitude.maximum).toBeUndefined();
    });

    it('drops format: uri for OpenAI, whose supported list omits it', () => {
      const { schema } = projectGenerationSchema(sourceSchema('account'), {
        provider: 'openai',
      });

      const webUrls =
        schema.properties.accounts.items.properties.accountContactInformation
          .properties.webUrls.items.properties.url;

      expect(webUrls.format).toBeUndefined();
    });

    it('keeps format: uri for Anthropic, whose supported list includes it', () => {
      const { schema } = projectGenerationSchema(sourceSchema('account'), {
        provider: 'anthropic',
      });

      const webUrls =
        schema.properties.accounts.items.properties.accountContactInformation
          .properties.webUrls.items.properties.url;

      expect(webUrls.format).toBe('uri');
    });

    it('keeps only date-time as a Gemini string format', () => {
      const openai = projectGenerationSchema(sourceSchema('order'), {
        provider: 'openai',
      }).schema;
      const gemini = projectGenerationSchema(sourceSchema('order'), {
        provider: 'gemini',
      }).schema;

      const orderDate = (schema) =>
        schema.properties.orders.items.properties.orderDate;

      expect(orderDate(openai).format).toBe('date-time');
      expect(orderDate(gemini).format).toBe('date-time');

      const email = projectGenerationSchema(sourceSchema('account'), {
        provider: 'gemini',
      }).schema.properties.accounts.items.properties.accountContactInformation
        .properties.emailAddresses.items.properties.emailAddress;

      expect(email.format).toBeUndefined();
    });

    it('marks a Gemini enum with the format the SDK requires', () => {
      const { schema } = projectGenerationSchema(sourceSchema('account'), {
        provider: 'gemini',
      });

      expect(schema.properties.accounts.items.properties.type).toMatchObject({
        enum: ['business', 'person'],
        format: 'enum',
        type: 'string',
      });
    });

    it('never emits minProperties, which no provider here supports', () => {
      for (const provider of ['anthropic', 'gemini', 'openai']) {
        const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
          provider,
        });

        for (const node of nodes(schema)) {
          expect(node.minProperties).toBeUndefined();
        }
      }
    });

    it('drops maxItems and out-of-range minItems for Anthropic', () => {
      // Anthropic accepts minItems only as 0 or 1.
      const source = {
        properties: {
          few: { items: { type: 'string' }, minItems: 1, type: 'array' },
          many: {
            items: { type: 'string' },
            maxItems: 9,
            minItems: 4,
            type: 'array',
          },
        },
        required: ['few', 'many'],
        type: 'object',
      };

      const { schema } = projectGenerationSchema(source, {
        provider: 'anthropic',
      });

      expect(schema.properties.few.minItems).toBe(1);
      expect(schema.properties.many.minItems).toBeUndefined();
      expect(schema.properties.many.maxItems).toBeUndefined();
    });
  });

  describe('object closure and optionality', () => {
    it('closes every object for OpenAI and Anthropic', () => {
      for (const provider of ['anthropic', 'openai']) {
        const { schema } = projectGenerationSchema(sourceSchema('account'), {
          provider,
        });

        for (const node of objectNodes(schema)) {
          expect(node.additionalProperties).toBe(false);
        }
      }
    });

    it('omits additionalProperties entirely for Gemini, which has no such field', () => {
      const { schema } = projectGenerationSchema(sourceSchema('account'), {
        provider: 'gemini',
      });

      for (const node of nodes(schema)) {
        expect('additionalProperties' in node).toBe(false);
      }
    });

    it('closes an object the source left open', () => {
      const { schema } = projectGenerationSchema(sourceSchema('product'), {
        languages: LANGUAGES,
        mode: 'advisory',
        provider: 'openai',
      });

      // product.json declares products.items as additionalProperties: true.
      expect(schema.properties.products.items.additionalProperties).toBe(false);
    });

    it('requires every property for OpenAI strict mode, optionals as null unions', () => {
      const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
        provider: 'openai',
      });

      const items = schema.properties.warehouses.items;

      expect(items.required.sort()).toEqual(
        Object.keys(items.properties).sort()
      );
      // `description` is not required by the source schema.
      expect(items.properties.description.type).toEqual(['object', 'null']);
      // `name` is, so it keeps its exact type.
      expect(items.properties.name.type).toBe('object');
    });

    it('leaves optional properties optional for Anthropic and Gemini', () => {
      for (const provider of ['anthropic', 'gemini']) {
        const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
          provider,
        });

        const items = schema.properties.warehouses.items;

        expect(items.required).not.toContain('description');
        expect(items.required).toContain('name');
      }
    });

    it('expresses a nullable source type in each provider dialect', () => {
      const source = {
        properties: {
          promoPrice: { type: ['number', 'null'] },
        },
        required: ['promoPrice'],
        type: 'object',
      };

      expect(
        projectGenerationSchema(source, { provider: 'openai' }).schema
          .properties.promoPrice
      ).toEqual({ type: ['number', 'null'] });

      expect(
        projectGenerationSchema(source, { provider: 'anthropic' }).schema
          .properties.promoPrice
      ).toEqual({ anyOf: [{ type: 'number' }, { type: 'null' }] });

      expect(
        projectGenerationSchema(source, { provider: 'gemini' }).schema
          .properties.promoPrice
      ).toEqual({ nullable: true, type: 'number' });
    });

    it('leaves an optional property out when its contents are undescribed', () => {
      const result = projectGenerationSchema(sourceSchema('account'), {
        provider: 'openai',
      });

      // account.json declares postalAddresses as items: { type: 'object' }.
      // No provider can express "any object", and AccountGenerator deletes
      // whatever the model puts there before rebuilding the addresses itself.
      expect(result.omitted).toEqual([
        '/accounts/items/accountContactInformation/postalAddresses',
        '/accounts/items/postalAddresses',
      ]);
      expect(
        result.schema.properties.accounts.items.properties.postalAddresses
      ).toBeUndefined();
      expect(result.schema).not.toBeNull();
    });
  });

  describe('advisory mode', () => {
    it('never blocks, and keeps the source required lists', () => {
      const { blockers, schema } = projectGenerationSchema(
        sourceSchema('product'),
        { languages: LANGUAGES, mode: 'advisory', provider: 'openai' }
      );

      expect(schema).not.toBeNull();
      expect(blockers).not.toHaveLength(0);

      const items = schema.properties.products.items;

      expect(items.required.sort()).toEqual([
        'baseSku',
        'description',
        'externalReferenceCode',
        'name',
        'productType',
        'shortDescription',
        'skus',
        'urls',
      ]);
      expect(items.properties.images.type).toBe('array');
    });

    it('still expands the locale maps, and leaves the option map open', () => {
      const { schema } = projectGenerationSchema(sourceSchema('product'), {
        languages: LANGUAGES,
        mode: 'advisory',
        provider: 'openai',
      });

      const items = schema.properties.products.items;

      expect(Object.keys(items.properties.description.properties)).toEqual([
        'en_US',
        'es_ES',
      ]);
      expect(items.properties.skuVariants.items.properties.options).toEqual({
        additionalProperties: { type: 'string' },
        description: 'The specific option combination, keyed by option name.',
        type: 'object',
      });
    });
  });

  describe('every shipped generation schema', () => {
    it.each(ENTITIES)(
      'projects %s for every provider or says why not',
      (entity) => {
        const source = sourceSchema(entity);

        for (const provider of ['anthropic', 'gemini', 'openai']) {
          const result = projectGenerationSchema(source, {
            languages: LANGUAGES,
            provider,
          });

          if (result.schema) {
            expect(result.blockers).toEqual([]);
            expect(result.schema.type).toBe('object');
          } else {
            expect(result.blockers.length).toBeGreaterThan(0);
          }
        }
      }
    );

    it.each(ENTITIES)('gives every %s node a type for Gemini', (entity) => {
      const { schema } = projectGenerationSchema(sourceSchema(entity), {
        languages: LANGUAGES,
        mode: 'advisory',
        provider: 'gemini',
      });

      // The SDK's ResponseSchema is a discriminated union on `type`, so a node
      // without one cannot be sent at all.
      for (const node of nodes(schema)) {
        expect(typeof node.type).toBe('string');
      }
    });

    it('classifies every open map in every schema', () => {
      // The registry is matched by property name, so a new open map that nobody
      // classified would silently be left open and block enforcement. This
      // lists them all so that cannot happen unnoticed.
      const unclassified = [];

      const walk = (node, name, pointer) => {
        if (Array.isArray(node)) {
          node.forEach((entry, index) =>
            walk(entry, name, `${pointer}/${index}`)
          );
          return;
        }
        if (!node || typeof node !== 'object') return;

        const open =
          node.additionalProperties &&
          typeof node.additionalProperties === 'object' &&
          !node.properties;

        if (open && !LOCALE_KEYED_PROPERTIES.has(name)) {
          unclassified.push(pointer);
        }

        for (const [key, value] of Object.entries(node)) {
          walk(value, key, `${pointer}/${key}`);
        }
      };

      for (const entity of ENTITIES) {
        walk(sourceSchema(entity), '', entity);
      }

      expect(unclassified).toEqual([
        'product/properties/products/items/properties/skuVariants/items/properties/options',
      ]);
    });
  });

  describe('composition with the ajv gate', () => {
    // The projection drops the value constraints a provider rejects, so the
    // two halves have to agree: anything the projected schema asks the model to
    // produce must still pass ajv. A strict projection that ajv then rejected
    // would turn every run into a retry loop.
    const facade = () =>
      new GenerationFacade({
        logger: {
          debug: () => {},
          error: () => {},
          info: () => {},
          warn: () => {},
        },
      });

    const validAgainst = (schema, instance) => {
      const ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      const valid = validate(instance);
      return { errors: validate.errors, valid };
    };

    it('accepts a warehouse shaped exactly as the OpenAI projection demands', () => {
      const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
        languages: LANGUAGES,
        provider: 'openai',
      });

      const payload = {
        warehouses: [
          {
            active: true,
            city: 'San Jose',
            country: 'US',
            // Optional in the source, so the projection made it a null union
            // and required it. A model complying with that returns null.
            description: null,
            externalReferenceCode: 'AICA-WH-1',
            latitude: 37.33,
            longitude: -121.89,
            name: { en_US: 'Main', es_ES: 'Principal' },
            region: 'CA',
            street1: '1 Innovation Way',
            zip: '95112',
          },
        ],
      };

      expect(validAgainst(schema, payload)).toMatchObject({ valid: true });

      // The null is dropped and the payload revalidated, so the run continues.
      const result = facade().validateAndNormalize('warehouse', payload, {
        count: 1,
      });

      expect(result).toHaveLength(1);
      expect(result[0].description).toBeUndefined();
      expect(result[0].name).toEqual({ en_US: 'Main', es_ES: 'Principal' });
    });

    it('closes a gap ajv cannot close, and keeps the one it can', () => {
      const { schema } = projectGenerationSchema(sourceSchema('warehouse'), {
        languages: ['en-US'],
        provider: 'openai',
      });

      // The reported failure, transposed to warehouse: the entity's own fields
      // put inside a locale map. Where those values happen to be strings, the
      // source schema accepts them - `additionalProperties: { type: 'string' }`
      // permits any key - so ajv cannot fault this at all. Only the projection
      // can, which is the gap structured output closes.
      const nested = {
        warehouses: [
          {
            active: true,
            city: 'San Jose',
            country: 'US',
            description: null,
            externalReferenceCode: 'AICA-WH-1',
            latitude: 37.33,
            longitude: -121.89,
            name: { city: 'San Jose', zip: '95112' },
            region: 'CA',
            street1: '1 Innovation Way',
            zip: '95112',
          },
        ],
      };

      expect(validAgainst(schema, nested).valid).toBe(false);

      // Same payload without the projection's null placeholder, so the only
      // thing left to object to is the misused locale map.
      const forAjv = structuredClone(nested);
      delete forAjv.warehouses[0].description;

      expect(validAgainst(sourceSchema('warehouse'), forAjv).valid).toBe(true);

      // Where the nested values are not strings, ajv does still catch it -
      // which is the failure #633 reports, and the half that keeps working.
      const nestedWithObjects = structuredClone(nested);
      nestedWithObjects.warehouses[0].name = { skus: [{ sku: 'WH-1' }] };

      expect(validAgainst(schema, nestedWithObjects).valid).toBe(false);
      expect(() =>
        facade().validateAndNormalize('warehouse', nestedWithObjects, {
          count: 1,
        })
      ).toThrow(/failed schema validation/);
    });
  });

  describe('expandLocaleMapsForPrompt', () => {
    it('names the locale keys and leaves everything else alone', () => {
      const expanded = expandLocaleMapsForPrompt(
        sourceSchema('warehouse'),
        LANGUAGES
      );

      const items = expanded.properties.warehouses.items;

      expect(Object.keys(items.properties.name.properties)).toEqual([
        'en_US',
        'es_ES',
      ]);
      expect(items.properties.name.additionalProperties).toBe(false);
      // The value constraints the providers reject are still described here,
      // because this copy is only ever read by the model.
      expect(items.properties.latitude.minimum).toBe(-90);
      expect(items.required).toContain('name');
    });

    it('does not mutate the source schema', () => {
      const source = sourceSchema('warehouse');
      const before = JSON.stringify(source);

      expandLocaleMapsForPrompt(source, LANGUAGES);

      expect(JSON.stringify(source)).toBe(before);
    });

    it('leaves the option map open', () => {
      const expanded = expandLocaleMapsForPrompt(
        sourceSchema('product'),
        LANGUAGES
      );

      expect(
        expanded.properties.products.items.properties.skuVariants.items
          .properties.options.additionalProperties
      ).toEqual({ type: 'string' });
    });
  });

  describe('projectGenerationSchema guards', () => {
    it('reports an unknown provider rather than throwing', () => {
      const result = projectGenerationSchema(sourceSchema('order'), {
        provider: 'nanobanana',
      });

      expect(result.schema).toBeNull();
      expect(result.blockers).toEqual(['unsupported provider: nanobanana']);
    });

    it('reports a schema that is not an object', () => {
      expect(projectGenerationSchema(null, { provider: 'openai' })).toEqual({
        blockers: ['schema is not an object'],
        omitted: [],
        schema: null,
      });
    });

    it('declines a schema that declares nothing under its root', () => {
      // The degenerate case: a json_schema saying only "an object" would
      // constrain nothing, so the provider is better off in plain JSON mode.
      for (const mode of ['advisory', 'enforced']) {
        expect(
          projectGenerationSchema(
            { type: 'object' },
            { mode, provider: 'openai' }
          ).schema
        ).toBeNull();
      }
    });
  });

  describe('looksLikeSchemaRejection', () => {
    it.each([
      [400, "Invalid schema for response_format 'product_response'"],
      [400, "Invalid schema: 'additionalProperties' is required to be false"],
      [400, 'output_config.format: unsupported keyword'],
      [400, 'Invalid JSON payload received. Unknown name "responseSchema"'],
    ])('recognises a %i rejecting the schema', (status, message) => {
      expect(looksLikeSchemaRejection({ message, status })).toBe(true);
    });

    it('does not treat a rate limit or a server error as a schema problem', () => {
      expect(
        looksLikeSchemaRejection({ message: 'rate limit', status: 429 })
      ).toBe(false);
      expect(
        looksLikeSchemaRejection({ message: 'overloaded', status: 529 })
      ).toBe(false);
    });

    it('requires a status, so a locally thrown error cannot trigger a retry', () => {
      // GenerationFacade throws "<entity> generation failed schema validation"
      // with no status. Retrying the provider call for that would be wasted.
      expect(
        looksLikeSchemaRejection(
          new Error('product generation failed schema validation')
        )
      ).toBe(false);
    });

    it('does not treat an unrelated bad request as a schema problem', () => {
      expect(
        looksLikeSchemaRejection({
          message: 'max_tokens must be greater than 0',
          status: 400,
        })
      ).toBe(false);
    });
  });
});
