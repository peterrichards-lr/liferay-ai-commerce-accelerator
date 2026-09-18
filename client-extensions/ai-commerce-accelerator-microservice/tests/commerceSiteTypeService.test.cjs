const {
  APPLICATION_BASE,
  CommerceSiteTypeService,
  MAX_ANNOTATED_CHANNELS,
  SITE_TYPES,
} = require('../services/commerceSiteTypeService.cjs');

const RESPONSE = {
  allowedAccountTypes: ['person'],
  channelId: 42,
  siteType: 0,
  siteTypeLabel: 'B2C',
  siteTypeStatus: 'CONFIGURED',
};

const logger = { debug: () => {} };

const serviceWith = (get) =>
  new CommerceSiteTypeService({
    liferayService: { rest: { _get: get } },
    logger,
  });

const rejectingWith = (status) => {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status };
  return () => Promise.reject(err);
};

describe('commerce site type service', () => {
  it('reads the site type for a channel', async () => {
    const service = serviceWith(() => Promise.resolve(RESPONSE));

    expect(await service.getChannelSiteType({}, 42)).toEqual(RESPONSE);
  });

  it('calls the module at its own application base', async () => {
    let url;
    const service = serviceWith((config, requested) => {
      url = requested;
      return Promise.resolve(RESPONSE);
    });

    await service.getChannelSiteType({}, 42);

    expect(url).toBe(`${APPLICATION_BASE}/channels/42/site-type`);
  });

  it('asks for a single attempt, so a missing module does not stall a run', async () => {
    let options;
    const service = serviceWith((config, url, op, friendly, opts) => {
      options = opts;
      return Promise.resolve(RESPONSE);
    });

    await service.getChannelSiteType({}, 42);

    expect(options).toEqual({ maxRetries: 1 });
  });

  it('reports nothing when the module is not deployed', async () => {
    const service = serviceWith(rejectingWith(404));

    expect(await service.getChannelSiteType({}, 42)).toBeNull();
  });

  it('reports nothing when the OAuth scope was not granted', async () => {
    const service = serviceWith(rejectingWith(403));

    expect(await service.getChannelSiteType({}, 42)).toBeNull();
  });

  it('reports nothing when the instance is unreachable', async () => {
    const service = serviceWith(() =>
      Promise.reject(new Error('ECONNREFUSED'))
    );

    expect(await service.getChannelSiteType({}, 42)).toBeNull();
  });

  it('reports nothing for a response carrying no status', async () => {
    const service = serviceWith(() => Promise.resolve({ channelId: 42 }));

    expect(await service.getChannelSiteType({}, 42)).toBeNull();
  });

  it('does not call out for a channel id that is not one', async () => {
    let called = false;
    const service = serviceWith(() => {
      called = true;
      return Promise.resolve(RESPONSE);
    });

    for (const id of [undefined, null, 0, -1, 'abc']) {
      expect(await service.getChannelSiteType({}, id)).toBeNull();
    }

    expect(called).toBe(false);
  });

  it('reports nothing when no Liferay client was supplied', async () => {
    const service = new CommerceSiteTypeService({ logger });

    expect(await service.getChannelSiteType({}, 42)).toBeNull();
  });
});

describe('annotating a channel list', () => {
  const channels = [
    { id: 1, name: 'Storefront' },
    { id: 2, name: 'Wholesale' },
  ];

  it('attaches the site type to each channel', async () => {
    const service = serviceWith(() => Promise.resolve(RESPONSE));

    const [first] = await service.annotateChannels({}, channels);

    expect(first).toMatchObject({
      allowedAccountTypes: ['person'],
      id: 1,
      name: 'Storefront',
      siteTypeLabel: 'B2C',
      siteTypeStatus: 'CONFIGURED',
    });
  });

  it('leaves a channel unchanged when its site type cannot be read', async () => {
    const service = serviceWith(rejectingWith(404));

    expect(await service.annotateChannels({}, channels)).toEqual(channels);
  });

  it('annotates the channels it can when only some fail', async () => {
    const service = serviceWith((config, url) =>
      url.includes('/channels/1/')
        ? Promise.resolve(RESPONSE)
        : Promise.reject(new Error('nope'))
    );

    const [first, second] = await service.annotateChannels({}, channels);

    expect(first.siteTypeLabel).toBe('B2C');
    expect(second).toEqual({ id: 2, name: 'Wholesale' });
  });

  it('returns a short or empty list untouched', async () => {
    const service = serviceWith(() => Promise.resolve(RESPONSE));

    expect(await service.annotateChannels({}, [])).toEqual([]);
    expect(await service.annotateChannels({}, undefined)).toBeUndefined();
  });

  it('stops annotating past the cap but still returns every channel', async () => {
    let calls = 0;
    const service = serviceWith(() => {
      calls += 1;
      return Promise.resolve(RESPONSE);
    });
    const many = Array.from({ length: MAX_ANNOTATED_CHANNELS + 5 }, (_, i) => ({
      id: i + 1,
    }));

    const result = await service.annotateChannels({}, many);

    expect(result).toHaveLength(many.length);
    expect(calls).toBe(MAX_ANNOTATED_CHANNELS);
    expect(result[MAX_ANNOTATED_CHANNELS].siteTypeLabel).toBeUndefined();
  });
});

/**
 * Setting a channel's commerce site type (#1045).
 *
 * The module has answered `PUT /channels/{id}/site-type` since v3.3.0, and
 * AICA pinned v3.5.4 in #1023, so the capability was deployed and unwired.
 *
 * What these are really about is the difference between a write being accepted
 * and a value being stored. A channel that has never had a site type set
 * *displays* B2C while holding nothing, and Liferay's own UI needs a
 * change-save-change-back-save cycle before the value sticks - so every
 * assertion below is on what the instance answers afterwards, never on what
 * was asked for.
 */
describe('setting a channel site type', () => {
  const storedAs = (siteType, overrides = {}) => ({
    allowedAccountTypes: ['business', 'supplier'],
    channelId: 42,
    configuredScope: 'GROUP',
    siteType,
    siteTypeLabel: 'B2B',
    siteTypeStatus: 'CONFIGURED',
    ...overrides,
  });

  const serviceWriting = ({ put, get }) => {
    const calls = [];

    const service = new CommerceSiteTypeService({
      liferayService: {
        rest: {
          _get: (...args) => {
            calls.push(['GET', ...args]);
            return get();
          },
          _put: (...args) => {
            calls.push(['PUT', ...args]);
            return put ? put() : Promise.resolve(storedAs(1));
          },
        },
      },
      logger: { debug: () => {}, warn: () => {} },
    });

    return { calls, service };
  };

  it('issues the PUT the module documents', async () => {
    const { calls, service } = serviceWriting({
      get: () => Promise.resolve(storedAs(1)),
    });

    await service.setChannelSiteType({}, 42, SITE_TYPES.B2B);

    const [verb, , url, body] = calls[0];

    expect(verb).toBe('PUT');
    expect(url).toBe(`${APPLICATION_BASE}/channels/42/site-type`);
    expect(body).toEqual({ siteType: 1 });
  });

  it('reports the write as done when the channel holds what was asked for', async () => {
    const { service } = serviceWriting({
      get: () => Promise.resolve(storedAs(1)),
    });

    expect(await service.setChannelSiteType({}, 42, SITE_TYPES.B2B)).toEqual({
      allowedAccountTypes: ['business', 'supplier'],
      configuredScope: 'GROUP',
      requested: 1,
      siteType: 1,
      siteTypeLabel: 'B2B',
      siteTypeStatus: 'CONFIGURED',
      success: true,
    });
  });

  /**
   * The write that does not persist. This is the one the issue turns on: the
   * PUT answers 200 with a payload saying the value landed, and the channel
   * still holds nothing.
   */
  it('fails when the value did not persist, however the write answered', async () => {
    const { service } = serviceWriting({
      put: () => Promise.resolve(storedAs(1)),
      get: () =>
        Promise.resolve(
          storedAs(0, {
            allowedAccountTypes: [],
            configuredScope: 'NONE',
            siteTypeLabel: 'B2C',
            siteTypeStatus: 'NOT_CONFIGURED',
          })
        ),
    });

    const result = await service.setChannelSiteType({}, 42, SITE_TYPES.B2B);

    expect(result.success).toBe(false);
    expect(result.siteType).toBe(0);
    expect(result.siteTypeStatus).toBe('NOT_CONFIGURED');
    expect(result.error).toContain('NOT_CONFIGURED');
  });

  it('reads the channel back rather than reporting the request', async () => {
    const { service } = serviceWriting({
      get: () => Promise.resolve(storedAs(2, { siteTypeLabel: 'B2X' })),
    });

    const result = await service.setChannelSiteType({}, 42, SITE_TYPES.B2B);

    expect(result.requested).toBe(1);
    expect(result.siteType).toBe(2);
    expect(result.success).toBe(false);
  });

  /**
   * `configuredScope` reads GROUP only when the value was found explicitly set
   * on this channel's own Group, so anything else is the channel answering
   * with somebody else's setting rather than with the one this write aimed at.
   */
  it('fails when the value landed somewhere other than the channel', async () => {
    const { service } = serviceWriting({
      get: () => Promise.resolve(storedAs(1, { configuredScope: 'COMPANY' })),
    });

    const result = await service.setChannelSiteType({}, 42, SITE_TYPES.B2B);

    expect(result.success).toBe(false);
    expect(result.error).toContain('COMPANY');
  });

  /**
   * A module build that reports no `configuredScope` has not thereby stored
   * the value in the wrong place, so an absent scope reads as "could not be
   * told" rather than as a failure - and `siteTypeStatus` is then the only
   * thing left that can tell a stored value from a defaulted one.
   */
  it('takes the write on trust when the scope cannot be told', async () => {
    const { service } = serviceWriting({
      get: () =>
        Promise.resolve({
          allowedAccountTypes: ['business', 'supplier'],
          channelId: 42,
          siteType: 1,
          siteTypeLabel: 'B2B',
          siteTypeStatus: 'CONFIGURED',
        }),
    });

    const result = await service.setChannelSiteType({}, 42, SITE_TYPES.B2B);

    expect(result.success).toBe(true);
    expect(result.configuredScope).toBeUndefined();
  });

  it('still fails an unconfigured channel when the scope cannot be told', async () => {
    const { service } = serviceWriting({
      get: () =>
        Promise.resolve({
          allowedAccountTypes: [],
          channelId: 42,
          siteType: 1,
          siteTypeLabel: 'UNKNOWN',
          siteTypeStatus: 'NOT_CONFIGURED',
        }),
    });

    const result = await service.setChannelSiteType({}, 42, SITE_TYPES.B2B);

    expect(result.success).toBe(false);
    expect(result.error).toContain('NOT_CONFIGURED');
  });

  it('accepts a site type that has been through a form', async () => {
    const { calls, service } = serviceWriting({
      get: () => Promise.resolve(storedAs(1)),
    });

    expect((await service.setChannelSiteType({}, 42, '1')).success).toBe(true);
    expect(calls[0][3]).toEqual({ siteType: 1 });
  });

  it('refuses a site type the module does not accept, without calling out', async () => {
    for (const rejected of [3, -1, 1.5, 'B2B', '', null, undefined, true, []]) {
      const { calls, service } = serviceWriting({
        get: () => Promise.resolve(storedAs(1)),
      });

      const result = await service.setChannelSiteType({}, 42, rejected);

      expect(result.success).toBe(false);
      expect(result.error).toContain('0 (B2C), 1 (B2B), 2 (B2X)');
      expect(calls).toEqual([]);
    }
  });

  it('refuses a channel id that is not one, without calling out', async () => {
    for (const id of [undefined, null, 0, -1, 'abc']) {
      const { calls, service } = serviceWriting({
        get: () => Promise.resolve(storedAs(1)),
      });

      expect((await service.setChannelSiteType({}, id, 1)).success).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it('reports the refusal when the write is rejected', async () => {
    const { service } = serviceWriting({
      put: rejectingWith(403),
      get: () => Promise.resolve(storedAs(1)),
    });

    const result = await service.setChannelSiteType({}, 42, SITE_TYPES.B2B);

    expect(result).toMatchObject({ requested: 1, success: false });
    expect(result.error).toContain('403');
  });

  it('does not read back after a write that was refused', async () => {
    const { calls, service } = serviceWriting({
      put: rejectingWith(404),
      get: () => Promise.resolve(storedAs(1)),
    });

    await service.setChannelSiteType({}, 42, SITE_TYPES.B2B);

    expect(calls.map(([verb]) => verb)).toEqual(['PUT']);
  });

  it('fails when nothing can be read back to confirm the write', async () => {
    const { service } = serviceWriting({ get: rejectingWith(404) });

    const result = await service.setChannelSiteType({}, 42, SITE_TYPES.B2B);

    expect(result.success).toBe(false);
    expect(result.error).toContain('could not be read back');
  });

  /**
   * Named rather than left to the call throwing on its own, so a service
   * assembled without a Liferay client says so instead of reporting whatever
   * `undefined._put` happens to produce.
   */
  it('reports a failure when no Liferay client was supplied', async () => {
    const service = new CommerceSiteTypeService({ logger });

    expect(await service.setChannelSiteType({}, 42, 1)).toEqual({
      error: 'No Liferay client is available to set the site type with.',
      requested: 1,
      success: false,
    });
  });
});
