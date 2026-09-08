const {
  APPLICATION_BASE,
  CONFIGURATION_EXTERNAL_REFERENCE_CODE,
  ClientExtensionEntryService,
  STATUS,
} = require('../services/clientExtensionEntryService.cjs');

const PORTLET_ID =
  'com_liferay_client_extension_web_internal_portlet_' +
  'ClientExtensionEntryPortlet_99367122642203_' +
  'LXC_liferay_ai_commerce_accelerator_configuration';

const RESPONSE = {
  companyId: 99367122642203,
  entryId: null,
  externalReferenceCode: `LXC:${CONFIGURATION_EXTERNAL_REFERENCE_CODE}`,
  hasPortlet: true,
  portletId: PORTLET_ID,
  sourceType: 'CONFIGURATION',
};

const logger = { debug: () => {} };

const serviceWith = (get) =>
  new ClientExtensionEntryService({
    liferayService: { rest: { _get: get } },
    logger,
  });

const rejectingWith = (status, data) => {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data };
  return () => Promise.reject(err);
};

describe('client extension entry service', () => {
  it('reports the portlet id the module composes', async () => {
    const service = serviceWith(() => Promise.resolve(RESPONSE));

    expect(await service.describeConfigurationExtension({})).toEqual({
      status: STATUS.RESOLVED,
      message: 'Configuration screen resolved for this instance.',
      externalReferenceCode: RESPONSE.externalReferenceCode,
      portletId: PORTLET_ID,
    });
  });

  it('asks the module for the code AICA declares, not the LXC: form', async () => {
    let url;
    const service = serviceWith((config, requested) => {
      url = requested;
      return Promise.resolve(RESPONSE);
    });

    await service.describeConfigurationExtension({});

    expect(url).toBe(
      `${APPLICATION_BASE}/entries/${CONFIGURATION_EXTERNAL_REFERENCE_CODE}`
    );
  });

  it('asks for a single attempt, so a missing module does not stall the panel', async () => {
    let options;
    const service = serviceWith((config, url, op, friendly, opts) => {
      options = opts;
      return Promise.resolve(RESPONSE);
    });

    await service.describeConfigurationExtension({});

    expect(options).toEqual({ maxRetries: 1 });
  });

  it('reports the module as unavailable when the route is not mounted', async () => {
    const service = serviceWith(rejectingWith(404, '<html>Not Found</html>'));

    const result = await service.describeConfigurationExtension({});

    expect(result.status).toBe(STATUS.MODULE_UNAVAILABLE);
    expect(result.portletId).toBeNull();
  });

  it("distinguishes the module's own 404 for an unknown code", async () => {
    const service = serviceWith(
      rejectingWith(404, { error: 'NotFound', message: 'No entry' })
    );

    const result = await service.describeConfigurationExtension({});

    expect(result.status).toBe(STATUS.EXTENSION_NOT_FOUND);
    expect(result.message).toContain(CONFIGURATION_EXTERNAL_REFERENCE_CODE);
  });

  // An empty-bodied 403 is Liferay refusing before the module is reached, and
  // a 403 carrying a body is the module refusing. The remedies are different -
  // grant the scope, or grant the permission - so the message has to say which.
  it('names the missing OAuth scope when the 403 has no body', async () => {
    const service = serviceWith(rejectingWith(403, ''));

    const result = await service.describeConfigurationExtension({});

    expect(result.status).toBe(STATUS.FORBIDDEN);
    expect(result.message).toContain(
      'Custom.Client.Extension.Entry.everything.read'
    );
  });

  it('names the missing permission when the 403 carries a body', async () => {
    const service = serviceWith(
      rejectingWith(403, { error: 'Forbidden', message: 'Denied' })
    );

    const result = await service.describeConfigurationExtension({});

    expect(result.status).toBe(STATUS.FORBIDDEN);
    expect(result.message).toContain('service account');
  });

  it('reports an extension that registers no portlet rather than inventing one', async () => {
    const service = serviceWith(() =>
      Promise.resolve({ ...RESPONSE, hasPortlet: false, portletId: null })
    );

    const result = await service.describeConfigurationExtension({});

    expect(result.status).toBe(STATUS.NO_PORTLET);
    expect(result.portletId).toBeNull();
  });

  it('degrades rather than throwing when no Liferay client is available', async () => {
    const service = new ClientExtensionEntryService({ logger });

    const result = await service.describeConfigurationExtension({});

    expect(result.status).toBe(STATUS.MODULE_UNAVAILABLE);
    expect(result.portletId).toBeNull();
  });

  it('degrades on any other failure', async () => {
    const service = serviceWith(rejectingWith(500, { error: 'Boom' }));

    const result = await service.describeConfigurationExtension({});

    expect(result.status).toBe(STATUS.UNAVAILABLE);
    expect(result.message).toContain('HTTP 500');
  });
});
