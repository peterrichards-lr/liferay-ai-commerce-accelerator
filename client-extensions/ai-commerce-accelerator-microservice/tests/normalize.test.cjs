// Removed the liferayEnv mock as it's brittle in CI.

const {
  sanitizeValue,
  sanitizedObject,
  redactUrl,
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

  describe('buildConfigAndOptions account type wiring', () => {
    const build = (body) =>
      buildConfigAndOptions({
        headers: {},
        body: {
          liferayUrl: 'http://test.com',
          clientId: 'test',
          clientSecret: 'test',
          ...body,
        },
      });

    it('carries accountType into options', () => {
      // It was validated by the request schema but never read here, so the
      // Account Type control had no effect at all. See #587.
      expect(build({ accountType: 'mixed' }).options.accountType).toBe('mixed');
    });

    it('defaults accountType to business when absent', () => {
      expect(build({}).options.accountType).toBe('business');
    });

    it('takes businessAccountRatio as a percentage', () => {
      expect(
        build({ businessAccountRatio: '70' }).options.businessAccountRatio
      ).toBe(70);
    });

    // The stored format was 0-1 until #729. A saved 0.7 has to keep meaning
    // "70% business" rather than becoming 0.7%, which is #711's failure.
    it('reads a legacy fraction as the percentage it meant', () => {
      expect(
        build({ businessAccountRatio: '0.7' }).options.businessAccountRatio
      ).toBe(70);
      expect(
        build({ businessAccountRatio: '1' }).options.businessAccountRatio
      ).toBe(100);
    });

    it('clamps the ratio into 0..100', () => {
      expect(
        build({ businessAccountRatio: '150' }).options.businessAccountRatio
      ).toBe(100);
      expect(
        build({ businessAccountRatio: '-2' }).options.businessAccountRatio
      ).toBe(0);
    });

    it('leaves the ratio undefined when absent so prior behaviour is preserved', () => {
      expect(build({}).options.businessAccountRatio).toBeUndefined();
    });
  });

  // Four options the form has always sent and the whitelist never named, so
  // they were validated (in orderDateRangeDays' case) and then discarded. The
  // demo dataset took the model's choice of order dates, status split, PDF
  // content type and generation path instead of the operator's. See #696.
  // Removed as redundant in #692, restored in #730: unchecking
  // createWarehouses covers "use only what is there" but not "create only the
  // shortfall", which is the state an operator asking for five warehouses on
  // an instance holding two actually wants.
  // The mode is the switch - 'none' already means off - so a mode that is on
  // with no ratio means everything. It used to mean nothing: the mode gate
  // opened, the absent ratio emptied the share, and a CLI run that sends a
  // mode and no ratio produced no media at all. See #736.
  describe('buildConfigAndOptions media mode implies a share', () => {
    const build = (body) =>
      buildConfigAndOptions({
        headers: {},
        body: {
          clientId: 'test',
          clientSecret: 'test',
          liferayUrl: 'http://test.com',
          ...body,
        },
      });

    it('gives a mode with no ratio the whole catalogue', () => {
      // Exactly what the CLI sends.
      expect(build({ imageMode: 'default' }).options.imageRatio).toBe(100);
      expect(build({ pdfMode: 'default' }).options.pdfRatio).toBe(100);
    });

    it('respects an explicit zero, which is a coherent request', () => {
      expect(build({ imageMode: 'ai', imageRatio: 0 }).options.imageRatio).toBe(
        0
      );
      expect(build({ pdfMode: 'ai', pdfRatio: 0 }).options.pdfRatio).toBe(0);
    });

    it('respects an explicit share', () => {
      expect(
        build({ imageMode: 'ai', imageRatio: 40 }).options.imageRatio
      ).toBe(40);
    });

    it('is zero when the mode is off, whatever the ratio says', () => {
      expect(
        build({ imageMode: 'none', imageRatio: 100 }).options.imageRatio
      ).toBe(0);
      expect(build({ pdfMode: 'none', pdfRatio: 100 }).options.pdfRatio).toBe(
        0
      );
    });

    it('is zero when no mode was given at all', () => {
      expect(build({}).options.imageRatio).toBe(0);
      expect(build({}).options.pdfRatio).toBe(0);
    });

    it('still reads a fraction as the percentage it must have been', () => {
      // #711's trap, unchanged by this.
      expect(
        build({ imageMode: 'ai', imageRatio: 0.5 }).options.imageRatio
      ).toBe(50);
    });
  });

  describe('buildConfigAndOptions warehouse reuse wiring', () => {
    const build = (body) =>
      buildConfigAndOptions({
        headers: {},
        body: {
          clientId: 'test',
          clientSecret: 'test',
          liferayUrl: 'http://test.com',
          ...body,
        },
      });

    it('defaults to reusing, which is the non-duplicating choice', () => {
      // Its original default was true; the CLI read `!== false`.
      expect(build({}).options.reuseExistingWarehouses).toBe(true);
    });

    it('carries an explicit false', () => {
      expect(
        build({ reuseExistingWarehouses: false }).options
          .reuseExistingWarehouses
      ).toBe(false);
    });

    it('carries the string a form sends, since a multipart body is all strings', () => {
      expect(
        build({ reuseExistingWarehouses: 'false' }).options
          .reuseExistingWarehouses
      ).toBe(false);
      expect(
        build({ reuseExistingWarehouses: 'true' }).options
          .reuseExistingWarehouses
      ).toBe(true);
    });
  });

  describe('buildConfigAndOptions order, media and seed pack wiring', () => {
    const build = (body) =>
      buildConfigAndOptions({
        headers: {},
        body: {
          liferayUrl: 'http://test.com',
          clientId: 'test',
          clientSecret: 'test',
          ...body,
        },
      });

    it('carries orderDateRangeDays as a number', () => {
      expect(
        build({ orderDateRangeDays: '90' }).options.orderDateRangeDays
      ).toBe(90);
      expect(build({ orderDateRangeDays: 90 }).options.orderDateRangeDays).toBe(
        90
      );
    });

    it('leaves orderDateRangeDays undefined when absent, so the reader keeps its own default', () => {
      expect(build({}).options.orderDateRangeDays).toBeUndefined();
    });

    it.each([
      [
        'a real object',
        { open: 10, processing: 10, shipped: 20, completed: 60 },
      ],
      [
        'the JSON string the multipart path sends',
        '{"open":10,"processing":10,"shipped":20,"completed":60}',
      ],
    ])('carries orderDistribution sent as %s', (_label, orderDistribution) => {
      expect(build({ orderDistribution }).options.orderDistribution).toEqual({
        open: 10,
        processing: 10,
        shipped: 20,
        completed: 60,
      });
    });

    it('carries pdfContentType', () => {
      expect(
        build({ pdfContentType: 'user_guide' }).options.pdfContentType
      ).toBe('user_guide');
    });

    it('carries seedPack, which selected a pack the backend never saw', () => {
      expect(
        build({ seedPack: 'outdoor-adventure-gear' }).options.seedPack
      ).toBe('outdoor-adventure-gear');
    });

    it('treats an unselected seed pack as no seed pack', () => {
      // The form's default is the empty string, and the route branches on
      // truthiness - carrying '' would send every run down the seed-pack path.
      expect(build({ seedPack: '' }).options.seedPack).toBeUndefined();
      expect(build({}).options.seedPack).toBeUndefined();
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
          liferayUrl: 'http://test.com',
          clientId: 'test',
          clientSecret: 'test',
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
          liferayUrl: 'http://test.com',
          clientId: 'test',
          clientSecret: 'test',
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

/**
 * A failed import leaves its products on the instance and its media in the
 * cache. Attaching that media afterwards needs the key, and until #893 there
 * was no path from a request to it - the import set it on itself and nobody
 * else could. Generating instead is not an answer: AI output is not
 * reproducible, so a second generation gives the same products different
 * pictures, which is the failure carrying media between instances exists to
 * prevent (#814).
 */
describe('buildConfigAndOptions - media bundle key (#893)', () => {
  const request = (body) => ({
    body: {
      clientId: 'test-client',
      clientSecret: 'test-secret',
      ...body,
    },
    headers: {},
    get: () => undefined,
  });

  it('carries a supplied mediaBundleKey through to options', () => {
    const { options } = buildConfigAndOptions(
      request({
        liferayUrl: 'http://localhost:8080',
        imageMode: 'bundle',
        mediaBundleKey: 'media-bundle:AICA-SESSION-1-0-abc',
        pdfMode: 'bundle',
      })
    );

    expect(options.mediaBundleKey).toBe('media-bundle:AICA-SESSION-1-0-abc');
    expect(options.imageMode).toBe('bundle');
    expect(options.pdfMode).toBe('bundle');
  });

  it('leaves it undefined when none is supplied', () => {
    const { options } = buildConfigAndOptions(
      request({ liferayUrl: 'http://localhost:8080', imageMode: 'ai' })
    );

    expect(options.mediaBundleKey).toBeUndefined();
  });

  it('gives bundle media the whole selection rather than a sampled share', () => {
    const { options } = buildConfigAndOptions(
      request({
        liferayUrl: 'http://localhost:8080',
        imageMode: 'bundle',
        mediaBundleKey: 'media-bundle:x',
        pdfMode: 'bundle',
      })
    );

    expect(options.imageRatio).toBe(100);
    expect(options.pdfRatio).toBe(100);
  });
});

/**
 * #674: config.reindexBasePath is the highest-priority input
 * LiferayRestService.triggerReindex reads, and until this AICA had no way to
 * put anything there - the field was absent from buildConfigAndOptions'
 * whitelist entirely, silently dropped if a caller sent one.
 */
describe('buildConfigAndOptions - reindex base path (#674)', () => {
  const request = (body) => ({
    body: {
      liferayUrl: 'http://localhost:8080',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      ...body,
    },
    headers: {},
    get: () => undefined,
  });

  it('sets config.reindexBasePath from the environment default', () => {
    const { REINDEX_BASE_PATH } = require('../utils/liferayUtils.cjs');
    const { config } = buildConfigAndOptions(request({}));

    expect(config.reindexBasePath).toBe(REINDEX_BASE_PATH);
  });

  it('ignores a client-supplied reindexBasePath rather than trusting the request', () => {
    // The base path names the environment this microservice is deployed
    // against - not the run someone just started - so two runs against one
    // instance must not be able to disagree about it. A per-request value here
    // would be exactly the whitelist entry #674 argued against adding.
    const { REINDEX_BASE_PATH } = require('../utils/liferayUtils.cjs');
    const { config } = buildConfigAndOptions(
      request({ reindexBasePath: '/attacker-supplied-path' })
    );

    expect(config.reindexBasePath).toBe(REINDEX_BASE_PATH);
    expect(config.reindexBasePath).not.toBe('/attacker-supplied-path');
  });
});

/**
 * The callback URL is logged in full, twice per batch submission, and once it
 * carries a signature that is a credential in the log.
 *
 * Two things hid it from the existing redaction. The submission is logged as a
 * *relative* path, so an `^https?://` guard returned it untouched; and the
 * callback URL is percent-encoded as the value of `callbackURL`, so its own
 * parameters are not query parameters to a single pass. See #812.
 */
describe('redacting the nested callback URL (#812)', () => {
  const TOKEN = 'a'.repeat(64);
  const inner = `http://localhost:3001/api/v1/batch/callback?batchERC=AICA-B-1&exp=1789405764877&token=${TOKEN}`;
  const outer = `/o/headless-commerce-admin-catalog/v1.0/products/batch?callbackURL=${encodeURIComponent(inner)}`;

  it('masks a token nested inside a query parameter', () => {
    const redacted = redactUrl(outer);

    expect(redacted).not.toContain(TOKEN);
    expect(redacted).toContain('REDACTED');
  });

  it('keeps the batch reference, which is what makes the line useful', () => {
    // Redaction that removed the identifier would trade one diagnostic problem
    // for another.
    expect(redactUrl(outer)).toContain('AICA-B-1');
  });

  it('redacts a relative path at all, which it previously skipped', () => {
    const relative = `/api/v1/thing?token=${TOKEN}`;

    expect(redactUrl(relative)).not.toContain(TOKEN);
    // Returned as a path, not rewritten to an absolute URL naming a
    // placeholder host.
    expect(redactUrl(relative).startsWith('/api/v1/thing')).toBe(true);
  });

  it('leaves an ordinary relative path alone', () => {
    expect(redactUrl('/api/v1/health')).toBe('/api/v1/health');
  });

  it('still returns anything it cannot parse unchanged', () => {
    expect(redactUrl('not a url at all')).toBe('not a url at all');
    expect(redactUrl(null)).toBeNull();
  });

  it('reaches the nested token through sanitizeValue, not just redactUrl', () => {
    // Through the deep sanitiser rather than the helper, because the gate that
    // hid this lives in `redactStringGeneric` - it tested for an absolute URL
    // before delegating, so a relative request path never reached the redactor
    // however well the redactor handled one. Calling `redactUrl` directly
    // passes with that gate still in place, which is why this test exists.
    const sanitised = sanitizeValue({ callbackUrl: outer, url: outer });

    expect(JSON.stringify(sanitised)).not.toContain(TOKEN);
    expect(JSON.stringify(sanitised)).toContain('AICA-B-1');
  });

  it('bounds its own recursion', () => {
    // A value that nests URLs repeatedly must not turn logging into a loop.
    let nested = `http://x.invalid/?token=${TOKEN}`;
    for (let i = 0; i < 8; i++) {
      nested = `http://x.invalid/?next=${encodeURIComponent(nested)}`;
    }

    expect(() => redactUrl(nested)).not.toThrow();
  });
});
