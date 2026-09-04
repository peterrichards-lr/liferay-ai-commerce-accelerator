const {
  APPLICATION_BASE,
  CommerceSiteTypeService,
  MAX_ANNOTATED_CHANNELS,
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
