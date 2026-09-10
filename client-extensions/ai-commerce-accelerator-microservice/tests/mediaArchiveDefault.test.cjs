const fs = require('fs');
const path = require('path');

// Deliberately sets no MEDIA_ARCHIVE_* variables: this is the shipped default,
// and it lives in its own file because `utils/constants.cjs` resolves the ENV
// layer at require time and `tests/mediaArchive.test.cjs` turns the feature on.
//
// Off is the default because the archive is the only thing here that writes
// hundreds of megabytes to a volume a PaaS restart may not preserve, and
// nothing reads the directory back yet - the export still resolves media from
// the source instance (#814). See #848.

const MediaGenerator = require('../generators/mediaGenerator.cjs');
const { ENV } = require('../utils/constants.cjs');
const { mediaArchiveSettings } = require('../utils/mediaArchive.cjs');

describe('The media archive ships switched off', () => {
  it('defaults to disabled, beside the database, with a retention policy', () => {
    expect(ENV.MEDIA_ARCHIVE_ENABLED).toBe(false);
    expect(mediaArchiveSettings()).toEqual({
      enabled: false,
      maxSessions: 10,
      retentionHours: 72,
      root: './data/media',
    });
  });

  it('writes nothing at all when it is not switched on', async () => {
    const created = await new MediaGenerator({
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      },
      liferay: {
        addProductImageByBase64: async () => ({
          externalReferenceCode: 'AICAIMG-1',
        }),
      },
      progress: {
        batchStarted: () => {},
        batchProgress: () => {},
        batchCompleted: () => {},
        batchFailed: () => {},
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
        sessionId: 'default-off',
        imageMode: 'custom',
        imageRatio: 100,
        customImageFile: { buffer: Buffer.from('bytes'), mime: 'image/png' },
      }
    );

    // The upload still happens; only the disk write is absent.
    expect(created).toHaveLength(1);

    const root = path.resolve(__dirname, '..', ENV.MEDIA_ARCHIVE_PATH);
    expect(fs.existsSync(path.join(root, 'default-off'))).toBe(false);
  });
});
