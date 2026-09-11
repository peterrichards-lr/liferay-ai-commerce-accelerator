const importRoutes = require('../routes/import.cjs');
const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { buildMediaBundle } = require('../utils/mediaBundle.cjs');

/**
 * What the import route hands the media steps (#872).
 *
 * #852 set `imageMode: 'bundle'` and never set the ratios, so `mediaGenerator`
 * selected a zero share, attached nothing, and the workflow reported success -
 * a promotion landing products with no pictures, from the code written to stop
 * exactly that.
 *
 * The existing media suites all passed while it was broken, because they drive
 * `createImages`/`createPdfs` directly with a ratio already set. The defect
 * lived in the seam between the route and the generator, so these drive the
 * real route and assert on the options it produces.
 */
describe('Import route: bundle media coverage (#872)', () => {
  let registeredRoutes;
  let persistenceService;

  const bundleFor = async (ercs) =>
    (
      await buildMediaBundle({
        dataset: {
          products: ercs.map((erc) => ({
            externalReferenceCode: erc,
            name: { en_US: erc },
          })),
        },
        media: ercs.map((erc) => ({
          buffer: Buffer.from(`${erc}-bytes`),
          contentType: 'image/webp',
          kind: 'image',
          priority: 1,
          productERC: erc,
          title: { en_US: erc },
        })),
      })
    ).buffer;

  const invoke = async (fileBuffer) => {
    const req = {
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'c',
        clientSecret: 's',
      },
      file: fileBuffer ? { buffer: fileBuffer } : undefined,
      headers: { host: 'localhost:3000' },
      correlationId: 'cid',
      method: 'POST',
      url: INTERNAL_API_PATHS.IMPORT_COMMERCE_DATA,
      ip: '127.0.0.1',
      get: () => 'vitest',
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await registeredRoutes[INTERNAL_API_PATHS.IMPORT_COMMERCE_DATA](req, res);

    return res;
  };

  const sessionOptions = () => {
    expect(persistenceService.createSession).toHaveBeenCalled();
    return persistenceService.createSession.mock.calls[0][0].context.options;
  };

  beforeEach(() => {
    registeredRoutes = {};
    persistenceService = {
      createSession: vi.fn().mockResolvedValue({}),
      getSession: vi.fn().mockResolvedValue(null),
    };

    importRoutes(
      {
        post: vi.fn((path, ...handlers) => {
          registeredRoutes[path] = handlers[handlers.length - 1];
        }),
      },
      {
        cacheService: { set: vi.fn(), get: vi.fn() },
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          trace: vi.fn(),
          debug: vi.fn(),
        },
        persistenceService,
        progressService: {},
        batchCallbackService: {},
        liferayService: {
          getCatalogs: vi
            .fn()
            .mockResolvedValue([{ id: 102, name: 'Catalog' }]),
          getChannels: vi
            .fn()
            .mockResolvedValue([
              { id: 301, name: 'Channel', siteGroupId: 900 },
            ]),
        },
        configService: {},
        workflowCoordinator: {},
        ws: {},
      }
    );
  });

  it('covers every product when a package carries media', async () => {
    await invoke(await bundleFor(['AICA-PRD-1', 'AICA-PRD-2']));

    const options = sessionOptions();

    // Zero here is the whole defect: selectShare returns nothing and the
    // attach steps run over an empty set.
    expect(options.imageMode).toBe('bundle');
    expect(options.imageRatio).toBe(100);
    expect(options.pdfMode).toBe('bundle');
    expect(options.pdfRatio).toBe(100);
  });

  it('leaves the media options absent for a plain JSON dataset', async () => {
    const dataset = {
      products: [{ externalReferenceCode: 'AICA-PRD-1', name: { en_US: 'P' } }],
    };

    await invoke(Buffer.from(JSON.stringify(dataset)));

    const options = sessionOptions();

    // 'none' is buildConfigAndOptions' default and is what stops the media
    // steps running. What matters is that a plain dataset is not given the
    // bundle mode or a share - a ratio here would schedule generation nobody
    // asked for, against a package carrying nothing to attach.
    expect(options.imageMode).toBe('none');
    expect(options.pdfMode).toBe('none');
    expect(options.imageRatio).not.toBe(100);
    expect(options.pdfRatio).not.toBe(100);
  });
});
