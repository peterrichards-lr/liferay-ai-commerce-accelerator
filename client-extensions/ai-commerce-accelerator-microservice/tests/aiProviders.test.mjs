import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import crypto from 'crypto';
import { server } from './setup.mjs';
import OpenAIProvider from '../services/ai-providers/openaiProvider.cjs';
import GeminiProvider from '../services/ai-providers/geminiProvider.cjs';

// A generation schema small enough to assert on, carrying the locale map that
// a whole entity body was once nested inside, an optional property, and a
// numeric bound the providers differ over. See #633.
const WAREHOUSE_SCHEMA = {
  properties: {
    warehouses: {
      items: {
        properties: {
          active: { type: 'boolean' },
          latitude: { maximum: 90, minimum: -90, type: 'number' },
          name: {
            additionalProperties: { type: 'string' },
            minProperties: 1,
            type: 'object',
          },
        },
        required: ['name', 'latitude'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['warehouses'],
  type: 'object',
};

// An open map that schemaProjection classifies as neither locale-keyed nor
// pair-keyed, so its keys cannot be written out and no provider can enforce the
// schema. No shipped generation schema is in this state since #691 gave
// skuVariants[].options a pair-array wire form, but a schema an administrator
// adds still can be, and these tests cover the degradation that answers it.
const UNENFORCEABLE_SCHEMA = {
  properties: {
    products: {
      items: {
        properties: {
          attributes: {
            additionalProperties: { type: 'string' },
            type: 'object',
          },
          name: { additionalProperties: { type: 'string' }, type: 'object' },
        },
        required: ['attributes', 'name'],
        type: 'object',
      },
      type: 'array',
    },
  },
  required: ['products'],
  type: 'object',
};

describe('AI Providers', () => {
  beforeEach(() => {
    // Clear any previous handlers
    server.resetHandlers();
  });

  describe('OpenAIProvider', () => {
    let provider;
    let mockCtx;

    beforeEach(() => {
      mockCtx = { logger: { error: vi.fn() } };
      provider = new OpenAIProvider(mockCtx);
    });

    it('should format payload correctly and generate JSON', async () => {
      let requestBody;
      server.use(
        http.post(
          'https://api.openai.com/v1/chat/completions',
          async ({ request }) => {
            requestBody = await request.json();
            return HttpResponse.json({
              choices: [{ message: { content: '{"status":"ok"}' } }],
            });
          }
        )
      );

      const options = {
        credentials: { apiKey: 'key' },
        model: 'gpt-4o',
        temperature: 0.5,
        maxTokens: 1000,
      };
      const schema = { type: 'object' };
      const result = await provider.generateJSON(
        'test-task',
        'test-prompt',
        options,
        schema
      );

      expect(result).toEqual({ status: 'ok' });
      expect(requestBody.model).toBe('gpt-4o');
      expect(requestBody.temperature).toBe(0.5);
      expect(requestBody.max_tokens).toBe(1000);
      expect(requestBody.response_format.type).toBe('json_object');
      expect(requestBody.messages[0].content).toContain('test-task');
      expect(requestBody.messages[0].content).toContain(JSON.stringify(schema));
      expect(requestBody.messages[1].content).toBe('test-prompt');
    });

    it('should throw explicit error when output is truncated due to length', async () => {
      server.use(
        http.post('https://api.openai.com/v1/chat/completions', () => {
          return HttpResponse.json({
            choices: [
              {
                finish_reason: 'length',
                message: { content: '{"partial":' },
              },
            ],
          });
        })
      );

      await expect(
        provider.generateJSON('test-task', 'prompt', {
          credentials: { apiKey: 'key' },
        })
      ).rejects.toThrow(/token limit reached/i);
    });

    it('should throw explicit error when response is invalid JSON', async () => {
      server.use(
        http.post('https://api.openai.com/v1/chat/completions', () => {
          return HttpResponse.json({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: 'This is not json at all' },
              },
            ],
          });
        })
      );

      await expect(
        provider.generateJSON('test-task', 'prompt', {
          credentials: { apiKey: 'key' },
        })
      ).rejects.toThrow(/unparseable JSON/i);
    });

    it('should generate an image with the current image model', async () => {
      let requestBody;
      server.use(
        http.post(
          'https://api.openai.com/v1/images/generations',
          async ({ request }) => {
            requestBody = await request.json();
            return HttpResponse.json({
              data: [{ b64_json: 'base64image' }],
            });
          }
        )
      );

      const options = { credentials: { apiKey: 'key' }, imageStyle: 'cartoon' };
      const result = await provider.generateImage(
        { name: { en_US: 'Product' } },
        options
      );

      expect(result).toBe('base64image');
      expect(requestBody.model).toBe('gpt-image-2');
      expect(requestBody.prompt).toContain('Product');
      expect(requestBody.prompt).toContain('cartoon');

      // The gpt-image family rejects this parameter outright, on the new
      // models and on the retired dall-e ones alike: 400 "Unknown parameter:
      // 'response_format'". Sending it failed every image run, not an
      // unusual one.
      expect(requestBody.response_format).toBeUndefined();
    });

    it('maps a dall-e quality onto one the image model accepts', async () => {
      let requestBody;
      server.use(
        http.post(
          'https://api.openai.com/v1/images/generations',
          async ({ request }) => {
            requestBody = await request.json();
            return HttpResponse.json({ data: [{ b64_json: 'base64image' }] });
          }
        )
      );

      // 'standard' is what normalize.cjs defaults to, and the image model
      // accepts only low, medium, high and auto - so the default itself was
      // invalid.
      await provider.generateImage(
        { name: { en_US: 'Product' } },
        { credentials: { apiKey: 'key' }, imageQuality: 'standard' }
      );

      expect(requestBody.quality).toBe('medium');
    });

    it('leaves an unrecognised quality to the provider rather than downgrading it', async () => {
      let requestBody;
      server.use(
        http.post(
          'https://api.openai.com/v1/images/generations',
          async ({ request }) => {
            requestBody = await request.json();
            return HttpResponse.json({ data: [{ b64_json: 'base64image' }] });
          }
        )
      );

      await provider.generateImage(
        { name: { en_US: 'Product' } },
        { credentials: { apiKey: 'key' }, imageQuality: 'ultra-fancy' }
      );

      expect(requestBody.quality).toBe('auto');
    });

    it('rounds the requested size to something the API will accept', async () => {
      let requestBody;
      server.use(
        http.post(
          'https://api.openai.com/v1/images/generations',
          async ({ request }) => {
            requestBody = await request.json();
            return HttpResponse.json({ data: [{ b64_json: 'base64image' }] });
          }
        )
      );

      // Both dimensions must be divisible by 16 or the API returns 400, and
      // neither may fall below the model's minimum pixel budget.
      await provider.generateImage(
        { name: { en_US: 'Product' } },
        {
          credentials: { apiKey: 'key' },
          imageWidth: 2000,
          imageHeight: 1500,
        }
      );

      expect(requestBody.size).toBe('2000x1504');
    });

    it('raises a size below the minimum pixel budget to the floor', async () => {
      // The configuration UI defaults both dimensions to 512, which gpt-image-2
      // rejects with "Requested resolution is below the current minimum pixel
      // budget" - so the default configuration produced no images at all.
      let requestBody;
      server.use(
        http.post(
          'https://api.openai.com/v1/images/generations',
          async ({ request }) => {
            requestBody = await request.json();
            return HttpResponse.json({ data: [{ b64_json: 'base64image' }] });
          }
        )
      );

      await provider.generateImage(
        { name: { en_US: 'Product' } },
        {
          credentials: { apiKey: 'key' },
          imageWidth: 512,
          imageHeight: 512,
        }
      );

      expect(requestBody.size).toBe('1024x1024');
    });

    it('falls back to the minimum when no size is given', async () => {
      let requestBody;
      server.use(
        http.post(
          'https://api.openai.com/v1/images/generations',
          async ({ request }) => {
            requestBody = await request.json();
            return HttpResponse.json({ data: [{ b64_json: 'base64image' }] });
          }
        )
      );

      await provider.generateImage(
        { name: { en_US: 'Product' } },
        { credentials: { apiKey: 'key' } }
      );

      expect(requestBody.size).toBe('1024x1024');
    });

    it('should validate credentials successfully', async () => {
      server.use(
        http.get('https://api.openai.com/v1/models', () => {
          return HttpResponse.json({ data: [] });
        })
      );

      const result = await provider.validateCredentials({ apiKey: 'key' });
      expect(result).toBe(true);
    });

    it('should return false if credentials validation fails', async () => {
      server.use(
        http.get('https://api.openai.com/v1/models', () => {
          return new HttpResponse(null, { status: 401 });
        })
      );

      const result = await provider.validateCredentials({ apiKey: 'key' });
      expect(result).toBe(false);
    });

    it('should scope client cache registry by apiKey hash and enforce LRU eviction with resource cleanup', async () => {
      const client1 = await provider._getClient({ apiKey: 'key1' });
      const client2 = await provider._getClient({ apiKey: 'key2' });
      expect(client1).not.toBe(client2);

      const client1Copy = await provider._getClient({ apiKey: 'key1' });
      expect(client1).toBe(client1Copy);

      const clients = [];
      for (let i = 0; i < 10; i++) {
        clients.push(await provider._getClient({ apiKey: `key-${i}` }));
      }
      expect(provider.clientRegistry.size).toBe(10);

      const mockAgent = { destroy: vi.fn() };
      const key0Hash = crypto
        .createHash('sha256')
        .update('key-0')
        .digest('hex');
      provider.clientRegistry.get(key0Hash).client.httpAgent = mockAgent;

      for (let i = 1; i < 10; i++) {
        await provider._getClient({ apiKey: `key-${i}` });
      }

      const client10 = await provider._getClient({ apiKey: 'key-10' });
      expect(provider.clientRegistry.size).toBe(10);
      expect(provider.clientRegistry.has(key0Hash)).toBe(false);
      expect(mockAgent.destroy).toHaveBeenCalled();
    });

    describe('structured output', () => {
      const captureCompletion = () => {
        const captured = {};
        server.use(
          http.post(
            'https://api.openai.com/v1/chat/completions',
            async ({ request }) => {
              captured.body = await request.json();
              return HttpResponse.json({
                choices: [{ message: { content: '{"status":"ok"}' } }],
              });
            }
          )
        );
        return captured;
      };

      it('sends an enforced json_schema, not the schema as prose', async () => {
        const captured = captureCompletion();

        await provider.generateJSON(
          'warehouse',
          'prompt',
          {
            credentials: { apiKey: 'key' },
            languages: ['en-US', 'es-ES'],
            model: 'gpt-4o-mini',
          },
          WAREHOUSE_SCHEMA
        );

        const format = captured.body.response_format;

        expect(format.type).toBe('json_schema');
        expect(format.json_schema.name).toBe('warehouse_response');
        expect(format.json_schema.strict).toBe(true);

        const items = format.json_schema.schema.properties.warehouses.items;

        // The locale map is written out, so nesting an entity inside it is no
        // longer expressible.
        expect(Object.keys(items.properties.name.properties)).toEqual([
          'en_US',
          'es_ES',
        ]);
        expect(items.properties.name.additionalProperties).toBe(false);
        expect(items.properties.name.minProperties).toBeUndefined();

        // Strict mode requires every property in `required`, so the optional
        // one is a union with null instead.
        expect(items.required.sort()).toEqual(['active', 'latitude', 'name']);
        expect(items.properties.active.type).toEqual(['boolean', 'null']);
        expect(items.properties.latitude.type).toBe('number');

        // OpenAI does support numeric bounds in strict mode.
        expect(items.properties.latitude.minimum).toBe(-90);

        expect(captured.body.messages[0].content).not.toContain(
          'conform to the following schema'
        );
      });

      it('sends an unenforced json_schema when strict mode cannot express the schema', async () => {
        const captured = captureCompletion();

        await provider.generateJSON(
          'product',
          'prompt',
          {
            credentials: { apiKey: 'key' },
            languages: ['en-US'],
            model: 'gpt-4o-mini',
          },
          UNENFORCEABLE_SCHEMA
        );

        const format = captured.body.response_format;

        expect(format.type).toBe('json_schema');
        expect(format.json_schema.strict).toBe(false);

        const items = format.json_schema.schema.properties.products.items;

        // The locale map is still written out - the part that matters here.
        expect(Object.keys(items.properties.name.properties)).toEqual([
          'en_US',
        ]);
        // The map that cannot be classified is left open.
        expect(items.properties.attributes.additionalProperties).toEqual({
          type: 'string',
        });
        // Nothing is enforced, so nothing is forced into `required` either.
        expect(items.required.sort()).toEqual(['attributes', 'name']);
      });

      it('uses plain JSON mode for a model that predates json_schema', async () => {
        const captured = captureCompletion();

        await provider.generateJSON(
          'warehouse',
          'prompt',
          { credentials: { apiKey: 'key' }, model: 'gpt-4-turbo' },
          WAREHOUSE_SCHEMA
        );

        expect(captured.body.response_format).toEqual({ type: 'json_object' });
        expect(captured.body.messages[0].content).toContain(
          'conform to the following schema'
        );
      });

      it('names the locale keys in the prose fallback', async () => {
        const captured = captureCompletion();

        await provider.generateJSON(
          'warehouse',
          'prompt',
          {
            credentials: { apiKey: 'key' },
            languages: ['en-US', 'fr-FR'],
            model: 'gpt-3.5-turbo',
          },
          WAREHOUSE_SCHEMA
        );

        const system = captured.body.messages[0].content;

        expect(system).toContain('"fr_FR"');
        // The prose copy keeps the value constraints, which only the model
        // reads.
        expect(system).toContain('"minimum":-90');
      });

      it('degrades to plain JSON mode when the schema is rejected', async () => {
        const bodies = [];
        server.use(
          http.post(
            'https://api.openai.com/v1/chat/completions',
            async ({ request }) => {
              bodies.push(await request.json());

              if (bodies.length === 1) {
                return HttpResponse.json(
                  {
                    error: {
                      message:
                        "Invalid schema for response_format 'warehouse_response'",
                      type: 'invalid_request_error',
                    },
                  },
                  { status: 400 }
                );
              }

              return HttpResponse.json({
                choices: [{ message: { content: '{"status":"ok"}' } }],
              });
            }
          )
        );

        const result = await provider.generateJSON(
          'warehouse',
          'prompt',
          { credentials: { apiKey: 'key' }, model: 'gpt-4o-mini' },
          WAREHOUSE_SCHEMA
        );

        expect(result).toEqual({ status: 'ok' });
        expect(bodies).toHaveLength(2);
        expect(bodies[1].response_format).toEqual({ type: 'json_object' });
        expect(bodies[1].messages[0].content).toContain(
          'conform to the following schema'
        );
      });

      it('reports a refusal rather than an unparseable-JSON error', async () => {
        server.use(
          http.post('https://api.openai.com/v1/chat/completions', () =>
            HttpResponse.json({
              choices: [
                { finish_reason: 'stop', message: { refusal: 'I cannot' } },
              ],
            })
          )
        );

        await expect(
          provider.generateJSON('warehouse', 'prompt', {
            credentials: { apiKey: 'key' },
            model: 'gpt-4o-mini',
          })
        ).rejects.toThrow(/declined to generate/i);
      });
    });
  });

  describe('GeminiProvider', () => {
    let provider;
    let mockCtx;

    beforeEach(() => {
      mockCtx = { logger: { error: vi.fn() } };
      provider = new GeminiProvider(mockCtx);
    });

    it('should format payload correctly and generate JSON', async () => {
      let requestBody;
      server.use(
        http.post(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5:generateContent',
          async ({ request }) => {
            requestBody = await request.json();
            return HttpResponse.json({
              candidates: [
                { content: { parts: [{ text: '{"status":"ok"}' }] } },
              ],
            });
          }
        )
      );

      const options = { credentials: { apiKey: 'key' }, model: 'gemini-1.5' };
      const schema = { type: 'object', properties: { test: 'val' } };
      const result = await provider.generateJSON(
        'test-task',
        'test-prompt',
        options,
        schema
      );

      expect(result).toEqual({ status: 'ok' });
      expect(requestBody.generationConfig.responseMimeType).toBe(
        'application/json'
      );

      const content = requestBody.contents[0].parts[0].text;
      expect(content).toContain('test-task');
      expect(content).toContain('test-prompt');
      expect(content).toContain(JSON.stringify(schema));
    });

    it('should throw unsupported error for generateImage', async () => {
      await expect(
        provider.generateImage({}, { credentials: { apiKey: 'key' } })
      ).rejects.toThrow('Image generation not supported');
    });

    it('should support mock-sandbox for zero-cost image mock', async () => {
      const result = await provider.generateImage(
        {},
        { credentials: { apiKey: 'mock-sandbox' } }
      );
      expect(result.url).toContain('mock-image.png');
    });

    it('should return true for validateCredentials when using mock-sandbox', async () => {
      const result = await provider.validateCredentials({
        apiKey: 'mock-sandbox',
      });
      expect(result).toBe(true);
    });

    it('should return schema-compliant pre-rendered mock JSON when generateJSON is called with mock-sandbox', async () => {
      const schema = { properties: { products: { type: 'array' } } };
      const result = await provider.generateJSON(
        'products',
        'prompt',
        { credentials: { apiKey: 'mock-sandbox' } },
        schema
      );

      expect(result.products).toHaveLength(2);
      expect(result.products[0].name.en_US).toBe('Premium Smart Watch');
    });

    it('should validate credentials successfully', async () => {
      server.use(
        http.post(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
          () => {
            return HttpResponse.json({
              candidates: [{ content: { parts: [{ text: 'pong' }] } }],
            });
          }
        )
      );

      const result = await provider.validateCredentials({ apiKey: 'key' });
      expect(result).toBe(true);
    });

    it('should return false if credentials validation fails', async () => {
      server.use(
        http.post(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
          () => {
            return new HttpResponse(null, { status: 401 });
          }
        )
      );

      const result = await provider.validateCredentials({ apiKey: 'key' });
      expect(result).toBe(false);
    });

    describe('structured output', () => {
      const GENERATE_URL =
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

      const captureGeneration = () => {
        const captured = {};
        server.use(
          http.post(GENERATE_URL, async ({ request }) => {
            captured.body = await request.json();
            return HttpResponse.json({
              candidates: [
                { content: { parts: [{ text: '{"status":"ok"}' }] } },
              ],
            });
          })
        );
        return captured;
      };

      it('sends a responseSchema in the subset the SDK accepts', async () => {
        const captured = captureGeneration();

        await provider.generateJSON(
          'warehouse',
          'prompt',
          {
            credentials: { apiKey: 'key' },
            languages: ['en-US', 'es-ES'],
            model: 'gemini-2.5-flash',
          },
          WAREHOUSE_SCHEMA
        );

        const config = captured.body.generationConfig;

        expect(config.responseMimeType).toBe('application/json');

        const items = config.responseSchema.properties.warehouses.items;

        expect(Object.keys(items.properties.name.properties)).toEqual([
          'en_US',
          'es_ES',
        ]);
        // responseSchema has no additionalProperties field at all.
        expect('additionalProperties' in items).toBe(false);
        expect('additionalProperties' in items.properties.name).toBe(false);
        // Nor minProperties, nor numeric bounds.
        expect(items.properties.name.minProperties).toBeUndefined();
        expect(items.properties.latitude.minimum).toBeUndefined();
        // Optional properties stay optional here.
        expect(items.required.sort()).toEqual(['latitude', 'name']);

        expect(captured.body.contents[0].parts[0].text).not.toContain(
          'conform to the following schema'
        );
      });

      it('describes the schema in the prompt when it cannot be projected', async () => {
        const captured = captureGeneration();

        await provider.generateJSON(
          'product',
          'prompt',
          {
            credentials: { apiKey: 'key' },
            languages: ['en-US'],
            model: 'gemini-2.5-flash',
          },
          UNENFORCEABLE_SCHEMA
        );

        expect(captured.body.generationConfig.responseSchema).toBeUndefined();

        const content = captured.body.contents[0].parts[0].text;

        expect(content).toContain('conform to the following schema');
        // Even in prose, the locale keys are named rather than left open.
        expect(content).toContain('"en_US"');
      });

      it('degrades to the prose path when the responseSchema is rejected', async () => {
        const bodies = [];
        server.use(
          http.post(GENERATE_URL, async ({ request }) => {
            bodies.push(await request.json());

            if (bodies.length === 1) {
              return HttpResponse.json(
                {
                  error: {
                    code: 400,
                    message:
                      'Invalid JSON payload received. Unknown name "responseSchema"',
                    status: 'INVALID_ARGUMENT',
                  },
                },
                { status: 400 }
              );
            }

            return HttpResponse.json({
              candidates: [
                { content: { parts: [{ text: '{"status":"ok"}' }] } },
              ],
            });
          })
        );

        const result = await provider.generateJSON(
          'warehouse',
          'prompt',
          { credentials: { apiKey: 'key' }, model: 'gemini-2.5-flash' },
          WAREHOUSE_SCHEMA
        );

        expect(result).toEqual({ status: 'ok' });
        expect(bodies).toHaveLength(2);
        expect(bodies[1].generationConfig.responseSchema).toBeUndefined();
        expect(bodies[1].contents[0].parts[0].text).toContain(
          'conform to the following schema'
        );
      });
    });
  });
});
