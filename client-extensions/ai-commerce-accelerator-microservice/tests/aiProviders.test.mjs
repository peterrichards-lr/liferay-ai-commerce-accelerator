import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import crypto from 'crypto';
import { server } from './setup.mjs';
import OpenAIProvider from '../services/ai-providers/openaiProvider.cjs';
import GeminiProvider from '../services/ai-providers/geminiProvider.cjs';

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

    it('should generate an image using dall-e-3', async () => {
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
      expect(requestBody.model).toBe('dall-e-3');
      expect(requestBody.prompt).toContain('Product');
      expect(requestBody.prompt).toContain('cartoon');
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
  });
});
