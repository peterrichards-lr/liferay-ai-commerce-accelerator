const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-archive-config-'));
process.env.MEDIA_ARCHIVE_PATH = ROOT;

const {
  MEDIA_ARCHIVE_DEFAULTS,
  normalizeMediaArchiveConfig,
} = require('../utils/mediaArchiveConfig.cjs');
const { mediaArchiveSettings } = require('../utils/mediaArchive.cjs');
const MediaGenerator = require('../generators/mediaGenerator.cjs');

// #917: retention decides whether a finished run can still be exported as a
// package, and it was environment-only - unchangeable on the instances where
// the client extensions are deliberately not deployed.
//
// The last describe is the one that matters. A panel that writes a value and a
// normaliser that reads it prove nothing between them: requestTimeoutMs,
// retry.*, maxTokens and the batch callbackUrl were all plumbed most of the
// way and dropped at the last step, and each was presented as authoritative
// while doing nothing.

describe('Reading the media archive configuration', () => {
  it('falls back to the shipped defaults when the entry is absent', () => {
    // An instance provisioned before this entry existed, and a read that
    // failed, both arrive here as an empty object. Neither may resolve to a
    // retention of zero.
    expect(normalizeMediaArchiveConfig(undefined)).toEqual(
      MEDIA_ARCHIVE_DEFAULTS
    );
    expect(normalizeMediaArchiveConfig({})).toEqual(MEDIA_ARCHIVE_DEFAULTS);
    expect(normalizeMediaArchiveConfig('not an object')).toEqual(
      MEDIA_ARCHIVE_DEFAULTS
    );
  });

  it('takes the operator’s values when they are there', () => {
    expect(
      normalizeMediaArchiveConfig({
        maxSessions: 3,
        retain: false,
        retentionHours: 12,
      })
    ).toEqual({ maxSessions: 3, retain: false, retentionHours: 12 });
  });

  it('accepts what a hand-edited JSON box produces', () => {
    // The configuration UI is a text editor, so a quoted boolean and a string
    // number are what actually arrive.
    expect(
      normalizeMediaArchiveConfig({
        maxSessions: '4',
        retain: 'false',
        retentionHours: '24',
      })
    ).toEqual({ maxSessions: 4, retain: false, retentionHours: 24 });
  });

  it('rejects a retention of zero rather than keeping nothing', () => {
    const resolved = normalizeMediaArchiveConfig({
      maxSessions: 0,
      retentionHours: 0,
    });

    // Clamping to zero would delete every package source on the next pass,
    // and the operator would have asked for it with a typo.
    expect(resolved.retentionHours).toBe(MEDIA_ARCHIVE_DEFAULTS.retentionHours);
    expect(resolved.maxSessions).toBe(MEDIA_ARCHIVE_DEFAULTS.maxSessions);
  });

  it('ignores a negative or unparseable value the same way', () => {
    expect(
      normalizeMediaArchiveConfig({ retentionHours: -5 }).retentionHours
    ).toBe(72);
    expect(
      normalizeMediaArchiveConfig({ retentionHours: 'soon' }).retentionHours
    ).toBe(72);
  });
});

describe('The configured values reach the archive', () => {
  it('is what mediaArchiveSettings resolves once they are passed in', () => {
    const configured = normalizeMediaArchiveConfig({
      maxSessions: 2,
      retain: false,
      retentionHours: 6,
    });

    expect(mediaArchiveSettings(configured)).toEqual({
      maxSessions: 2,
      retain: false,
      retentionHours: 6,
      root: ROOT,
    });
  });

  it('is read by the generator, and prunes by the configured cap', async () => {
    // The assertion that distinguishes this from a setting nobody reads.
    // Spying on the module export would prove nothing: the generator
    // destructures openMediaArchive at import time, so a stub on the module
    // is never the function it calls. This drives the real one and looks at
    // what it did - with a cap of 1, opening an archive must prune the older
    // session directories, and that only happens if the configured value
    // travelled all the way through.
    for (const stale of ['older-run-a', 'older-run-b']) {
      fs.mkdirSync(path.join(ROOT, stale), { recursive: true });
      fs.writeFileSync(
        path.join(ROOT, stale, 'manifest.json'),
        JSON.stringify({ files: [], unresolved: [], version: 1 })
      );
    }

    await new MediaGenerator({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      config: {
        getMediaArchiveConfig: async () => ({
          maxSessions: 1,
          retain: true,
          retentionHours: 72,
        }),
      },
      liferay: {
        addProductImageByBase64: async () => ({
          externalReferenceCode: 'AICAIMG-1',
        }),
      },
      progress: {
        batchStarted() {},
        batchProgress() {},
        batchCompleted() {},
        batchFailed() {},
      },
      ai: {},
    }).createImages(
      {},
      [
        {
          externalReferenceCode: 'P1',
          name: { en_US: 'P1' },
          skus: [{ sku: 'P1-SKU' }],
        },
      ],
      {
        sessionId: 'configured-run',
        imageMode: 'custom',
        imageRatio: 100,
        customImageFile: { buffer: Buffer.from('bytes'), mime: 'image/png' },
      }
    );

    // The run's own directory is never a candidate; the two older ones are,
    // and a cap of 1 leaves room for none of them.
    expect(fs.existsSync(path.join(ROOT, 'configured-run'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'older-run-a'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'older-run-b'))).toBe(false);
  });

  it('keeps them when the configured cap has room, so the prune is not just always-on', async () => {
    // The other half of the pair: without it, a prune that deleted everything
    // regardless of configuration would pass the test above.
    fs.mkdirSync(path.join(ROOT, 'kept-run'), { recursive: true });
    fs.writeFileSync(
      path.join(ROOT, 'kept-run', 'manifest.json'),
      JSON.stringify({ files: [], unresolved: [], version: 1 })
    );

    await new MediaGenerator({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      config: {
        getMediaArchiveConfig: async () => ({
          maxSessions: 50,
          retain: true,
          retentionHours: 72,
        }),
      },
      liferay: {
        addProductImageByBase64: async () => ({
          externalReferenceCode: 'AICAIMG-3',
        }),
      },
      progress: {
        batchStarted() {},
        batchProgress() {},
        batchCompleted() {},
        batchFailed() {},
      },
      ai: {},
    }).createImages(
      {},
      [
        {
          externalReferenceCode: 'P3',
          name: { en_US: 'P3' },
          skus: [{ sku: 'P3-SKU' }],
        },
      ],
      {
        sessionId: 'roomy-run',
        imageMode: 'custom',
        imageRatio: 100,
        customImageFile: { buffer: Buffer.from('bytes'), mime: 'image/png' },
      }
    );

    expect(fs.existsSync(path.join(ROOT, 'kept-run'))).toBe(true);
  });

  it('still writes media when the configuration cannot be read', async () => {
    // A configuration service that throws must not cost the run its media:
    // the environment and then the shipped defaults answer instead.
    const warnings = [];

    const created = await new MediaGenerator({
      logger: {
        info() {},
        warn: (message) => warnings.push(message),
        error() {},
        debug() {},
      },
      config: {
        getMediaArchiveConfig: async () => {
          throw new Error('Liferay is unreachable');
        },
      },
      liferay: {
        addProductImageByBase64: async () => ({
          externalReferenceCode: 'AICAIMG-2',
        }),
      },
      progress: {
        batchStarted() {},
        batchProgress() {},
        batchCompleted() {},
        batchFailed() {},
      },
      ai: {},
    }).createImages(
      {},
      [
        {
          externalReferenceCode: 'P2',
          name: { en_US: 'P2' },
          skus: [{ sku: 'P2-SKU' }],
        },
      ],
      {
        sessionId: 'unreachable-config',
        imageMode: 'custom',
        imageRatio: 100,
        customImageFile: { buffer: Buffer.from('bytes'), mime: 'image/png' },
      }
    );

    expect(created).toHaveLength(1);
    expect(warnings.join(' ')).toContain('media archive configuration');
    expect(
      fs.existsSync(path.join(ROOT, 'unreachable-config', 'manifest.json'))
    ).toBe(true);
  });
});
