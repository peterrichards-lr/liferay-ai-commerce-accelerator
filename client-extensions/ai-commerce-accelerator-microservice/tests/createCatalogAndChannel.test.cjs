const getRoutes = require('../routes/get.cjs');
const {
  CommerceSiteTypeService,
} = require('../services/commerceSiteTypeService.cjs');
const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');

/**
 * Creating a catalog, and creating a channel whose site type is proved (#746).
 *
 * Two rules are under test, and they are different rules.
 *
 * The first is the one `create-channel` already applies (#745): the route
 * substitutes nothing. It matters more for a catalog, because a channel created
 * in the wrong currency is corrected by choosing a different channel, while a
 * catalog created in the wrong currency is corrected by deleting it and
 * everything generated into it.
 *
 * The second is that a commerce site type is only reported as set when the
 * instance is read back and agrees. A brand-new channel *displays* B2C while
 * storing nothing - `siteType` comes through Liferay's fallback and defaults to
 * "0" whether or not anyone set it - so a `PUT` that answers 200 is not
 * evidence. The tests that matter here are the ones where the write is accepted
 * and the value is not there.
 */
describe('Create catalog and channel (#746)', () => {
  let registeredRoutes;
  let liferayService;
  let commerceSiteTypeService;
  let logger;
  let postCatalog;
  let getSitesPage;

  const CONNECTION = {
    liferayUrl: 'http://localhost:8080',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    localeCode: 'en-US',
  };

  const invoke = async (path, body) => {
    const req = {
      body,
      headers: { host: 'localhost:3000' },
      correlationId: 'test-cid',
      method: 'POST',
      url: path,
      ip: '127.0.0.1',
      get: () => 'vitest',
    };
    const res = {
      statusCode: 200,
      status: vi.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn().mockReturnThis(),
    };

    await registeredRoutes[path](req, res);

    return res;
  };

  const bodyOf = (res) => res.json.mock.calls[0][0];

  beforeEach(() => {
    registeredRoutes = {};
    postCatalog = vi.fn().mockResolvedValue({
      id: 41002,
      name: 'Solara Moto',
      currencyCode: 'EUR',
      defaultLanguageId: 'en_US',
    });
    getSitesPage = vi.fn().mockResolvedValue({
      items: [
        { id: 40188, name: 'Solara', friendlyUrlPath: '/solara', extra: 'x' },
      ],
    });

    liferayService = {
      client: {
        headlessAdminSite: { v1_0: { getSitesPage } },
        headlessCommerceAdminCatalog: { v1_0: { postCatalog } },
      },
      createChannel: vi.fn().mockResolvedValue({
        id: 35094,
        name: 'Solara Storefront',
        currencyCode: 'EUR',
        siteGroupId: 40188,
        type: 'site',
      }),
    };

    commerceSiteTypeService = {
      getChannelSiteType: vi.fn().mockResolvedValue({
        siteType: '1',
        siteTypeLabel: 'B2B',
        siteTypeStatus: 'CONFIGURED',
        allowedAccountTypes: ['business'],
      }),
      setChannelSiteType: vi.fn().mockResolvedValue({ ok: true }),
    };

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      debug: vi.fn(),
    };

    getRoutes(
      {
        post: vi.fn((path, ...handlers) => {
          registeredRoutes[path] = handlers[handlers.length - 1];
        }),
      },
      { commerceSiteTypeService, liferayService, logger }
    );
  });

  describe('create-catalog substitutes nothing', () => {
    const create = (body) =>
      invoke(INTERNAL_API_PATHS.CREATE_CATALOG, { ...CONNECTION, ...body });

    const VALID = {
      currencyCode: 'EUR',
      defaultLanguageId: 'en_US',
      name: 'Solara Moto',
    };

    it('creates the catalog with exactly what it was given', async () => {
      const res = await create(VALID);

      expect(postCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ liferayUrl: 'http://localhost:8080' }),
        { currencyCode: 'EUR', defaultLanguageId: 'en_US', name: 'Solara Moto' }
      );
      expect(bodyOf(res)).toMatchObject({
        success: true,
        catalog: { id: 41002, currencyCode: 'EUR' },
      });
    });

    it.each([
      ['omitted', undefined],
      ['null', null],
      ['empty', ''],
      ['whitespace', '   '],
    ])(
      'refuses when the currency is %s, rather than using USD',
      async (_label, currencyCode) => {
        const res = await create({ ...VALID, currencyCode });

        expect(postCatalog).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);

        const body = bodyOf(res);
        expect(body.success).toBe(false);
        expect(body.error).toMatch(/currencyCode is required/i);
        expect(body.error).not.toMatch(/USD/);
      }
    );

    it.each([
      ['omitted', undefined],
      ['empty', ''],
      ['whitespace', '   '],
    ])(
      'refuses when the name is %s, rather than naming it itself',
      async (_label, name) => {
        const res = await create({ ...VALID, name });

        expect(postCatalog).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(bodyOf(res).error).toMatch(/name is required/i);
      }
    );

    it.each([
      ['omitted', undefined],
      ['empty', ''],
      ['whitespace', '   '],
    ])(
      'refuses when the default language is %s, rather than choosing en_US',
      async (_label, defaultLanguageId) => {
        const res = await create({ ...VALID, defaultLanguageId });

        expect(postCatalog).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);

        const body = bodyOf(res);
        expect(body.error).toMatch(/defaultLanguageId is required/i);
        expect(body.error).not.toMatch(/en_US/);
      }
    );

    it('never sends USD to Liferay unless USD was asked for', async () => {
      await create({ ...VALID, currencyCode: 'GBP' });
      await create({ ...VALID, currencyCode: undefined });
      await create({ ...VALID, currencyCode: '' });

      expect(postCatalog.mock.calls.map(([, p]) => p.currencyCode)).toEqual([
        'GBP',
      ]);
    });

    it('reports a Liferay failure rather than claiming success', async () => {
      postCatalog.mockRejectedValue(new Error('Catalog name already in use'));

      const res = await create(VALID);

      expect(bodyOf(res)).toMatchObject({ success: false });
      expect(bodyOf(res).error).toMatch(/Catalog name already in use/);
    });
  });

  describe('get-sites', () => {
    it('answers with the sites a channel can be attached to', async () => {
      const res = await invoke(INTERNAL_API_PATHS.GET_SITES, CONNECTION);

      expect(bodyOf(res)).toMatchObject({
        success: true,
        sites: [{ id: 40188, name: 'Solara', friendlyUrlPath: '/solara' }],
      });
    });

    it('carries only the three fields the dialog needs', async () => {
      const res = await invoke(INTERNAL_API_PATHS.GET_SITES, CONNECTION);

      expect(Object.keys(bodyOf(res).sites[0]).sort()).toEqual([
        'friendlyUrlPath',
        'id',
        'name',
      ]);
    });

    it('answers with an empty list rather than throwing on an odd response', async () => {
      getSitesPage.mockResolvedValue({});

      expect(
        bodyOf(await invoke(INTERNAL_API_PATHS.GET_SITES, CONNECTION))
      ).toMatchObject({ success: true, sites: [] });
    });
  });

  describe('create-channel attaches the site it was given', () => {
    const create = (body) =>
      invoke(INTERNAL_API_PATHS.CREATE_CHANNEL, {
        ...CONNECTION,
        currencyCode: 'EUR',
        name: 'Solara Storefront',
        ...body,
      });

    it('sends the siteGroupId, so the channel has languages', async () => {
      await create({ siteGroupId: 40188 });

      expect(liferayService.createChannel).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ siteGroupId: 40188 })
      );
    });

    it.each([
      ['omitted', undefined],
      ['zero', 0],
      ['not a number', 'guest'],
    ])(
      'leaves the site absent when it is %s, rather than picking one',
      async (_label, siteGroupId) => {
        await create({ siteGroupId });

        const [, payload] = liferayService.createChannel.mock.calls[0];
        expect(payload).not.toHaveProperty('siteGroupId');
      }
    );
  });

  /**
   * The read-back is the evidence. Every case here is written so that trusting
   * the `PUT` instead would give the wrong answer.
   */
  describe('the commerce site type is proved, not assumed', () => {
    const create = (body = {}) =>
      invoke(INTERNAL_API_PATHS.CREATE_CHANNEL, {
        ...CONNECTION,
        currencyCode: 'EUR',
        name: 'Solara Storefront',
        siteGroupId: 40188,
        siteType: 'B2B',
        ...body,
      });

    /**
     * The dialog offers the labels the module reports a channel under; the wire
     * format is `0|1|2`. The map is the service's own and is imported, so the
     * browser never holds a copy of it - this is the boundary that translates.
     */
    it.each([
      ['B2C', 0],
      ['B2B', 1],
      ['B2X', 2],
      ['b2x', 2],
    ])('sends %s to the setter as the code %i', async (label, code) => {
      await create({ siteType: label });

      expect(commerceSiteTypeService.setChannelSiteType).toHaveBeenCalledWith(
        expect.objectContaining({ liferayUrl: 'http://localhost:8080' }),
        35094,
        code
      );
    });

    it('leaves a value it does not recognise for the service to refuse', async () => {
      await create({ siteType: 'B2Q' });

      expect(commerceSiteTypeService.setChannelSiteType).toHaveBeenCalledWith(
        expect.anything(),
        35094,
        'B2Q'
      );
    });

    it('reads the type back rather than trusting the write', async () => {
      await create();

      expect(commerceSiteTypeService.getChannelSiteType).toHaveBeenCalledWith(
        expect.anything(),
        35094
      );
    });

    /**
     * The setter reads back for itself, so a second read is not issued - but
     * the verdict is still the route's. `applied` needs the setter's success
     * *and* the type it reports being the one that was asked for.
     */
    it('uses the setter’s own read-back when it supplies one', async () => {
      commerceSiteTypeService.setChannelSiteType.mockResolvedValue({
        success: true,
        requested: 1,
        siteType: 1,
        siteTypeLabel: 'B2B',
        siteTypeStatus: 'CONFIGURED',
        configuredScope: 'GROUP',
      });

      const { siteType } = bodyOf(await create());

      expect(commerceSiteTypeService.getChannelSiteType).not.toHaveBeenCalled();
      expect(siteType).toMatchObject({ applied: true, reason: 'confirmed' });
    });

    it('refuses to claim applied when the setter reports another type as success', async () => {
      commerceSiteTypeService.setChannelSiteType.mockResolvedValue({
        success: true,
        siteType: 0,
        siteTypeLabel: 'B2C',
        siteTypeStatus: 'CONFIGURED',
      });

      expect(bodyOf(await create()).siteType).toMatchObject({
        applied: false,
        reason: 'unconfirmed',
      });
    });

    /**
     * The case only the setter can see. The channel answers `CONFIGURED` with
     * the type that was asked for, and the setter still says no - because the
     * value was found at company scope rather than on this channel's own Group,
     * so it is somebody else's setting and the write landed nowhere. Everything
     * this route can check agrees; the verdict has to be honoured.
     */
    it('honours a setter that says no while the channel appears to agree', async () => {
      commerceSiteTypeService.setChannelSiteType.mockResolvedValue({
        success: false,
        configuredScope: 'COMPANY',
        siteType: 1,
        siteTypeLabel: 'B2B',
        siteTypeStatus: 'CONFIGURED',
        error: 'Asked for 1, but the channel reports it at COMPANY scope.',
      });

      const { siteType } = bodyOf(await create());

      expect(siteType.applied).toBe(false);
      expect(siteType.reason).toBe('unconfirmed');
    });

    it('reports the setter’s own failed read-back as unconfirmed, not refused', async () => {
      commerceSiteTypeService.setChannelSiteType.mockResolvedValue({
        success: false,
        siteType: 0,
        siteTypeLabel: 'B2C',
        siteTypeStatus: 'NOT_CONFIGURED',
        error: 'Asked for 1, the channel reports 0.',
      });

      const { siteType } = bodyOf(await create());

      expect(siteType).toMatchObject({ applied: false, reason: 'unconfirmed' });
      expect(siteType.message).toMatch(/did not persist/);
    });

    it('reports applied only when the read-back confirms it', async () => {
      const res = await create();

      expect(bodyOf(res).siteType).toMatchObject({
        applied: true,
        reason: 'confirmed',
        requested: 'B2B',
        siteTypeLabel: 'B2B',
      });
    });

    // The defect this exists for: the write succeeds, the channel still reads
    // as the B2C that Liferay's fallback produces, and nothing stored it.
    it('refuses to claim applied when the value did not persist', async () => {
      commerceSiteTypeService.getChannelSiteType.mockResolvedValue({
        siteType: '0',
        siteTypeLabel: 'B2C',
        siteTypeStatus: 'NOT_CONFIGURED',
      });

      const { siteType } = bodyOf(await create());

      expect(siteType.applied).toBe(false);
      expect(siteType.reason).toBe('unconfirmed');
      expect(siteType.message).toMatch(/did not persist/);
      expect(siteType.message).toMatch(/B2C/);
    });

    /**
     * The trap in its purest form. Ask for B2C on a new channel and the module
     * answers B2C - not because anything stored it, but because Liferay's
     * fallback produces "0" for a channel nobody configured. The requested
     * value and the reported value agree, and the write still did nothing. Only
     * `configured` separates the two, which is why the status is checked rather
     * than the value alone.
     */
    it('refuses to claim applied when the fallback merely echoes the request', async () => {
      commerceSiteTypeService.getChannelSiteType.mockResolvedValue({
        siteType: '0',
        siteTypeLabel: 'B2C',
        siteTypeStatus: 'NOT_CONFIGURED',
      });

      const { siteType } = bodyOf(await create({ siteType: 'B2C' }));

      expect(siteType.applied).toBe(false);
      expect(siteType.reason).toBe('unconfirmed');
      expect(siteType.message).toMatch(/did not persist/);
    });

    // CONFIGURED but a different type: something set it, and not to this.
    it('refuses to claim applied when the read-back names another type', async () => {
      commerceSiteTypeService.getChannelSiteType.mockResolvedValue({
        siteType: '0',
        siteTypeLabel: 'B2C',
        siteTypeStatus: 'CONFIGURED',
      });

      expect(bodyOf(await create()).siteType).toMatchObject({
        applied: false,
        reason: 'unconfirmed',
      });
    });

    it('refuses to claim applied when the module answers with nothing', async () => {
      commerceSiteTypeService.getChannelSiteType.mockResolvedValue(null);

      const { siteType } = bodyOf(await create());

      expect(siteType.applied).toBe(false);
      expect(siteType.message).toMatch(/unset/);
    });

    it('keeps the channel when the write is refused', async () => {
      commerceSiteTypeService.setChannelSiteType.mockRejectedValue(
        new Error('403 Forbidden')
      );

      const body = bodyOf(await create());

      expect(body.success).toBe(true);
      expect(body.channel.id).toBe(35094);
      expect(body.siteType).toMatchObject({
        applied: false,
        reason: 'refused',
      });
      expect(body.siteType.message).toMatch(/403 Forbidden/);
    });

    // #1045's setter reports a bad value rather than throwing, matching how
    // every other call on that module degrades. A reported failure is the same
    // outcome as a thrown one and must not be mistaken for a write.
    it('keeps the channel when the write reports a failure instead of throwing', async () => {
      commerceSiteTypeService.setChannelSiteType.mockResolvedValue({
        success: false,
        error: "'B2Q' is not a commerce site type.",
      });

      const body = bodyOf(await create());

      expect(body.success).toBe(true);
      expect(body.channel.id).toBe(35094);
      expect(body.siteType).toMatchObject({
        applied: false,
        reason: 'refused',
      });
      expect(body.siteType.message).toMatch(/is not a commerce site type/);
      expect(commerceSiteTypeService.getChannelSiteType).not.toHaveBeenCalled();
    });

    // #1045 owns the setter. Until it lands the module has no write, and that
    // is a stated outcome rather than a crash that takes the channel with it.
    it('says so when this build has no setter at all', async () => {
      delete commerceSiteTypeService.setChannelSiteType;

      const body = bodyOf(await create());

      expect(body.success).toBe(true);
      expect(body.siteType).toMatchObject({
        applied: false,
        reason: 'unsupported',
      });
      expect(commerceSiteTypeService.getChannelSiteType).not.toHaveBeenCalled();
    });

    it.each([
      ['omitted', undefined],
      ['empty', ''],
      ['whitespace', '  '],
    ])(
      'attempts nothing when the site type is %s',
      async (_label, siteType) => {
        const body = bodyOf(await create({ siteType }));

        expect(
          commerceSiteTypeService.setChannelSiteType
        ).not.toHaveBeenCalled();
        expect(body.siteType).toBeNull();
      }
    );

    it('matches the read-back on the numeric value as well as the label', async () => {
      commerceSiteTypeService.getChannelSiteType.mockResolvedValue({
        siteType: '1',
        siteTypeLabel: 'Business to Business',
        siteTypeStatus: 'CONFIGURED',
      });

      expect(bodyOf(await create({ siteType: '1' })).siteType).toMatchObject({
        applied: true,
      });
    });
  });

  /**
   * The route and the real service together, because the translation only
   * matters if the label the dialog offers reaches the module as the number it
   * accepts. Mocking the service proves the route's half and would pass equally
   * well if the two halves disagreed - which they did, before this: the service
   * refuses `'B2B'` outright and answers only to `1`.
   */
  describe('a label from the dialog reaches the module as a code', () => {
    it('puts { siteType: 1 } on the wire for B2B', async () => {
      const put = vi.fn().mockResolvedValue({});
      const rest = {
        _put: put,
        _get: vi.fn().mockResolvedValue({
          configuredScope: 'GROUP',
          siteType: 1,
          siteTypeLabel: 'B2B',
          siteTypeStatus: 'CONFIGURED',
        }),
      };

      registeredRoutes = {};
      getRoutes(
        {
          post: vi.fn((path, ...handlers) => {
            registeredRoutes[path] = handlers[handlers.length - 1];
          }),
        },
        {
          commerceSiteTypeService: new CommerceSiteTypeService({
            liferayService: { rest },
            logger,
          }),
          liferayService,
          logger,
        }
      );

      const res = await invoke(INTERNAL_API_PATHS.CREATE_CHANNEL, {
        ...CONNECTION,
        currencyCode: 'EUR',
        name: 'Solara Storefront',
        siteGroupId: 40188,
        siteType: 'B2B',
      });

      expect(put).toHaveBeenCalledWith(
        expect.anything(),
        '/o/commerce-site-type/channels/35094/site-type',
        { siteType: 1 },
        expect.any(String),
        expect.any(String)
      );
      expect(bodyOf(res).siteType).toMatchObject({
        applied: true,
        reason: 'confirmed',
      });
    });
  });
});
