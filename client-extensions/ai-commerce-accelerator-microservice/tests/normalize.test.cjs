// Mock liferayEnv to avoid complex environment dependencies before normalize requires it
vi.mock('../utils/liferayEnv.cjs', () => ({
  resolveEffectiveLiferayConnection: vi.fn().mockImplementation((config) => ({
    liferayUrl: config.liferayUrl || 'http://localhost:8080',
    clientId: config.clientId || 'test-client',
    clientSecret: config.clientSecret || 'test-secret',
    isColocated: false,
  })),
}));

const {
  sanitizeValue,
  redactUrl,
  sanitizedObject,
  buildConfigAndOptions,
} = require('../utils/normalize.cjs');

describe('Data Normalization', () => {
  describe('redactUrl', () => {
    it('should redact sensitive query parameters in a URL', () => {
      const url = 'https://liferay.com/api?token=super-secret-jwt&other=123';
      const redacted = redactUrl(url);
      expect(redacted).toBe(
        'https://liferay.com/api?token=sup%E2%80%A6%5BREDACTED%5D%E2%80%A6jwt&other=123'
      );
    });

    it('should handle malformed URLs gracefully without crashing', () => {
      const malformed = 'https://liferay.com/api?token=foo bar';
      // URL parsing works on space if encoded, but new URL() might throw or encode.
      // We just want to ensure it doesn't crash.
      expect(typeof redactUrl(malformed)).toBe('string');
    });

    it('should not redact non-sensitive query params', () => {
      const url = 'https://liferay.com/api?page=1&size=20';
      expect(redactUrl(url)).toBe(url);
    });
  });

  describe('sanitizeValue', () => {
    it('should redact fields that match sensitive key patterns', () => {
      const input = {
        normalField: 'hello',
        apiKey: 'sk-1234567890abcdef',
        nested: {
          clientSecret: 'secret-xyz-789',
        },
      };

      const sanitized = sanitizeValue(input);
      expect(sanitized.normalField).toBe('hello');
      expect(sanitized.apiKey).toBe('sk-…[REDACTED]…def');
      expect(sanitized.nested.clientSecret).toBe('sec…[REDACTED]…789');
    });

    it('should redact Bearer tokens', () => {
      const input = { header: 'Bearer 1234567890' };
      expect(sanitizeValue(input).header).toBe('Bearer [REDACTED]');
    });

    it('should mask base64 blobs', () => {
      const base64Str = Buffer.from(
        'this is a very long string that should definitely be encoded as base64 to be detected.'
      ).toString('base64');
      const input = { data: base64Str };
      const sanitized = sanitizeValue(input);
      expect(sanitized.data).toContain('[BASE64]');
    });

    it('should handle arrays of sensitive data', () => {
      const input = { tokens: ['token1234567890', 'token7890123456'] };
      const sanitized = sanitizeValue(input);
      expect(sanitized.tokens).toBe('[REDACTED]');
    });
  });

  describe('buildConfigAndOptions', () => {
    it('should construct microserviceUrl correctly from request headers if not provided', () => {
      const req = {
        headers: {
          'x-forwarded-proto': 'https',
          host: 'my-microservice.com',
        },
        body: {
          productCount: '10',
          demoMode: 'true',
        },
      };

      const result = buildConfigAndOptions(req);
      expect(result.config.microserviceUrl).toBe('https://my-microservice.com');
      expect(result.options.productCount).toBe(10);
      expect(result.options.demoMode).toBe(true);
    });

    it('should ignore invalid microservice URLs', () => {
      const req = {
        headers: {},
        body: {
          microserviceUrl: 'not_a_valid_url',
        },
      };

      const result = buildConfigAndOptions(req);
      expect(result.config.microserviceUrl).toBeUndefined();
    });
  });

  describe('sanitizedObject', () => {
    it('should specifically redact certain known sensitive root keys and custom files', () => {
      const obj = {
        clientSecret: 'secret',
        Authorization: 'Basic 123',
        openaiApiKey: 'sk-123',
        customImageFile: { buffer: Buffer.from('img'), mimetype: 'image/jpeg' },
      };

      const redacted = sanitizedObject(obj);
      expect(redacted.clientSecret).toBe('[REDACTED]');
      expect(redacted.Authorization).toBe('[REDACTED]');
      expect(redacted.openaiApiKey).toBe('[REDACTED]');
      expect(redacted.customImageFile.buffer).toBe('[REDACTED]');
      expect(redacted.customImageFile.mimetype).toBe('image/jpeg');
    });
  });
});
