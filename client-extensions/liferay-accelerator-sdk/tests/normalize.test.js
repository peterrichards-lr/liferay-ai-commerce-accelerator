import { describe, it, expect } from 'vitest';
const normalize = require('../src/utils/normalize.cjs');

describe('utils/normalize', () => {
  describe('toBoolean', () => {
    it('should convert booleans and valid strings correctly', () => {
      expect(normalize.toBoolean(true)).toBe(true);
      expect(normalize.toBoolean('true')).toBe(true);
      expect(normalize.toBoolean('1')).toBe(true);
      expect(normalize.toBoolean('yes')).toBe(true);
      expect(normalize.toBoolean('y')).toBe(true);
      expect(normalize.toBoolean('on')).toBe(true);
      expect(normalize.toBoolean('   TRUE   ')).toBe(true);

      expect(normalize.toBoolean(false)).toBe(false);
      expect(normalize.toBoolean('false')).toBe(false);
      expect(normalize.toBoolean('no')).toBe(false);
      expect(normalize.toBoolean(null)).toBe(false);
      expect(normalize.toBoolean(undefined)).toBe(false);
      expect(normalize.toBoolean(123)).toBe(false);
    });
  });

  describe('toNumber', () => {
    it('should parse numbers and number-like strings', () => {
      expect(normalize.toNumber(123)).toBe(123);
      expect(normalize.toNumber('123')).toBe(123);
      expect(normalize.toNumber('12.34')).toBe(12.34);
      expect(normalize.toNumber('abc')).toBeUndefined();
      expect(normalize.toNumber(NaN)).toBeUndefined();
      expect(normalize.toNumber(null)).toBe(0); // Number(null) is 0
      expect(normalize.toNumber(undefined)).toBeUndefined();
    });
  });

  describe('parseMaybeJSON', () => {
    it('should parse JSON strings or return original value', () => {
      expect(normalize.parseMaybeJSON(null)).toBeUndefined();
      expect(normalize.parseMaybeJSON(undefined)).toBeUndefined();
      expect(normalize.parseMaybeJSON('  ')).toBeUndefined();
      expect(normalize.parseMaybeJSON({ a: 1 })).toEqual({ a: 1 });
      expect(normalize.parseMaybeJSON('{"a":1}')).toEqual({ a: 1 });
      expect(normalize.parseMaybeJSON('plain text')).toBe('plain text');
    });
  });

  describe('bufferToDataUrl', () => {
    it('should format buffers into data URLs', () => {
      const buffer = Buffer.from('hello');
      expect(normalize.bufferToDataUrl(buffer, 'text/plain')).toBe(
        'data:text/plain;base64,aGVsbG8='
      );
      expect(normalize.bufferToDataUrl(buffer)).toBe(
        'data:application/octet-stream;base64,aGVsbG8='
      );
    });
  });

  describe('maskMiddle', () => {
    it('should mask middle characters of long strings', () => {
      expect(normalize.maskMiddle('abcdefghijklmnop', 3, 3, 'TEST')).toBe(
        'abc…[TEST]…nop'
      );
      expect(normalize.maskMiddle('short')).toBe('short');
      expect(normalize.maskMiddle(12345)).toBe(12345);
    });
  });

  describe('sanitizedERC', () => {
    it('should format external reference codes safely', () => {
      expect(normalize.sanitizedERC('Hello & World!')).toBe('Hello_AND_World');
      expect(normalize.sanitizedERC('---special@@chars---')).toBe(
        '---special_chars---'
      );
      expect(normalize.sanitizedERC('__already_clean__')).toBe('already_clean');
    });
  });

  describe('sanitizedObject', () => {
    it('should redact sensitive properties from configuration objects', () => {
      const obj = {
        clientSecret: 'secret-key',
        Authorization: 'Bearer token123',
        openaiApiKey: 'sk-123456',
        otherKey: 'safe-value',
        customImageFile: { buffer: Buffer.from('image'), name: 'a.jpg' },
        customPdfFile: { buffer: Buffer.from('pdf'), name: 'b.pdf' },
      };

      const result = normalize.sanitizedObject(obj);
      expect(result.clientSecret).toBe('[REDACTED]');
      expect(result.Authorization).toBe('[REDACTED]');
      expect(result.openaiApiKey).toBe('[REDACTED]');
      expect(result.otherKey).toBe('safe-value');
      expect(result.customImageFile.buffer).toBe('[REDACTED]');
      expect(result.customPdfFile.buffer).toBe('[REDACTED]');
    });
  });

  describe('parseBatchStatuses', () => {
    it('should convert map of statuses into array lists', () => {
      const map = {
        'batch-1': 'success',
        'batch-2': 'failed',
      };
      expect(normalize.parseBatchStatuses(map)).toEqual([
        { batchId: 'batch-1', status: 'success' },
        { batchId: 'batch-2', status: 'failed' },
      ]);
    });
  });

  describe('redactUrl', () => {
    it('should redact sensitive query parameters from URLs', () => {
      expect(normalize.redactUrl('not-a-url')).toBe('not-a-url');
      expect(normalize.redactUrl(123)).toBe(123);
      expect(normalize.redactUrl('http://localhost:8080/api?safe=1')).toBe(
        'http://localhost:8080/api?safe=1'
      );
      expect(
        normalize.redactUrl('http://localhost:8080/api?token=secret123456789')
      ).toBe(
        'http://localhost:8080/api?token=sec%E2%80%A6%5BREDACTED%5D%E2%80%A6789'
      );
    });
  });

  describe('sanitizeValue and related deep sanitization', () => {
    it('should sanitize nested objects and handle arrays', () => {
      const entry = {
        key: 'some_key',
        value: {
          token: 'Bearer token-1234567890',
          apiKey: 'sk-proj-someApiKey123456',
          nested: {
            OPENAI_API_KEY: 'sk-987654321',
          },
          url: 'http://localhost?token=sensitive-token-values',
          base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
          list: ['safe', 'Bearer token-9876543210'],
        },
      };

      const sanitized = normalize.sanitizeCacheEntry(entry);
      expect(sanitized.key).toBe('some_key');
      expect(sanitized.value.apiKey).toBe('sk-…[REDACTED]…456');
      expect(sanitized.value.nested.OPENAI_API_KEY).toBe('sk-…[REDACTED]…321');
      expect(sanitized.value.base64).toBe(
        'data:image/png;base64,[REDACTED len=50]'
      );
      expect(sanitized.value.list[1]).toBe('Bearer [REDACTED]');
    });

    it('should sanitize array values at root', () => {
      const list = ['safe', 'Bearer token-1234567890'];
      const result = normalize.sanitizeCacheDump(list);
      expect(result[0]).toBe('safe');
      expect(result[1]).toBe('Bearer [REDACTED]');
    });

    it('should match likely JWT and Base64 Blobs', () => {
      // Mock a fake JWT: header.payload.signature
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const result = normalize.sanitizeValue(jwt);
      expect(result).toContain('[JWT]');

      // Mock a base64 blob
      const base64Blob =
        'dGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgYmxvYiB0aGF0IHNob3VsZCBiZSByZWRhY3RlZCBieSBvdXIgc2FuaXRpemVyIGZ1bmN0aW9u';
      const result2 = normalize.sanitizeValue(base64Blob);
      expect(result2).toContain('[BASE64]');
    });
  });

  describe('buildConfigAndOptions', () => {
    it('should construct config and options from request body and headers', () => {
      const req = {
        body: {
          batchSize: '15',
          catalogId: '20202',
          channelId: '30303',
          liferayUrl: 'http://localhost:8080',
          imageMode: 'picsum',
          pdfMode: 'placeholder',
          selectedLanguages: ['en-US', 'es-ES'],
          demoMode: 'true',
          clientId: 'test-client',
          clientSecret: 'test-secret',
        },
        headers: {
          'x-correlation-id': 'custom-correlation-id',
        },
        app: {
          locals: {
            oauthService: {
              isLiferayRouteAvailable: () => false,
            },
          },
        },
      };

      const result = normalize.buildConfigAndOptions(req);
      expect(result.config.batchSize).toBe(15);
      expect(result.config.catalogId).toBe(20202);
      expect(result.config.channelId).toBe(30303);
      expect(result.config.correlationId).toBe('custom-correlation-id');
      expect(result.config.liferayUrl).toBe('http://localhost:8080');

      expect(result.options.demoMode).toBe(true);
      expect(result.options.imageMode).toBe('picsum');
      expect(result.options.pdfMode).toBe('placeholder');
      expect(result.options.customImageFile).toBeUndefined();
    });

    it('should fallback and build microservice URL from headers when absent', () => {
      const req = {
        body: {
          liferayUrl: 'http://localhost:8080',
          clientId: 'test-client',
          clientSecret: 'test-secret',
        },
        headers: {
          host: 'aica.local',
        },
        secure: true,
        app: {
          locals: {
            oauthService: {
              isLiferayRouteAvailable: () => false,
            },
          },
        },
      };

      const result = normalize.buildConfigAndOptions(req);
      expect(result.config.microserviceUrl).toBe('https://aica.local');
    });

    it('should retrieve custom files if mode is set to custom', () => {
      const req = {
        body: {
          liferayUrl: 'http://localhost:8080',
          imageMode: 'custom',
          pdfMode: 'custom',
          clientId: 'test-client',
          clientSecret: 'test-secret',
        },
        headers: {},
        files: {
          customImageFile: [
            {
              buffer: Buffer.from('img'),
              mimetype: 'image/png',
              originalname: 'img.png',
            },
          ],
          customPDFFile: [
            {
              buffer: Buffer.from('pdf'),
              mimetype: 'application/pdf',
              originalname: 'pdf.pdf',
            },
          ],
        },
        app: {
          locals: {
            oauthService: {
              isLiferayRouteAvailable: () => false,
            },
          },
        },
      };

      const result = normalize.buildConfigAndOptions(req);
      expect(result.options.customImageFile.filename).toBe('img.png');
      expect(result.options.customPdfFile.filename).toBe('pdf.pdf');
    });
  });
});
