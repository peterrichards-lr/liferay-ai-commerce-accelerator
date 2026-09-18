import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import useCommerceData from './useCommerceData';
import { useApp, useApi } from '../context/AppContext';
import notifyUser from '../utils/notifications';

vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
  useApi: vi.fn(),
}));

vi.mock('../utils/notifications', () => ({ default: vi.fn() }));

/**
 * The setup dialog's create, and the currency it is allowed to decide (#745,
 * #746).
 *
 * The measured failure was a channel created in USD for a run configured as
 * EUR, with nothing on screen saying so, and its consequence was euro price
 * lists written into a dollar catalog. So the assertions here are about the
 * currency having exactly one source - the catalog - about a refusal when no
 * catalog names one, and about every difference between what was asked for and
 * what came back being said out loud.
 *
 * Several are written so they would fail if the currency reached Liferay from
 * anywhere but the catalog, rather than merely being present.
 */
describe('useCommerceData: the setup dialog creates (#746)', () => {
  let addLog;
  let setConfig;
  let api;

  const CREATED_CATALOG = {
    id: 41002,
    name: 'Solara Moto',
    currencyCode: 'EUR',
    defaultLanguageId: 'en_US',
  };

  const CREATED_CHANNEL = {
    id: 35094,
    name: 'Solara Storefront',
    currencyCode: 'EUR',
    siteGroupId: 40188,
  };

  const mountWith = (
    config,
    { catalogResponse = null, channelResponse = null, catalogs = [] } = {}
  ) => {
    setConfig = vi.fn();
    addLog = vi.fn();

    api = {
      post: vi.fn(async (path) => {
        if (path.endsWith('/create-catalog')) {
          return catalogResponse ?? { success: true, catalog: CREATED_CATALOG };
        }
        if (path.endsWith('/create-channel')) {
          return channelResponse ?? { success: true, channel: CREATED_CHANNEL };
        }
        if (path.endsWith('/get-catalogs')) return { catalogs };
        return { channels: [], sites: [], warehouses: [] };
      }),
      get: vi.fn().mockResolvedValue({}),
    };

    useApp.mockReturnValue({
      config: { liferayUrl: 'http://localhost:8080', ...config },
      setConfig,
      getLanguages: vi.fn().mockResolvedValue({ languages: [] }),
      getCurrencies: vi.fn().mockResolvedValue({ currencies: [] }),
    });
    useApi.mockReturnValue(api);

    return renderHook(() =>
      useCommerceData({
        addLog,
        setConnectionEstablished: vi.fn(),
        setAiKeyAvailable: vi.fn(),
        setAiMediaKeyAvailable: vi.fn(),
        setConnectionErrors: vi.fn(),
        setProgress: vi.fn(),
      })
    );
  };

  const callTo = (suffix) =>
    api.post.mock.calls.find(([path]) => path.endsWith(suffix));

  const loggedMessages = () => addLog.mock.calls.map(([message]) => message);

  const CATALOG = {
    currencyCode: 'EUR',
    defaultLanguageId: 'en_US',
    name: 'Solara Moto',
  };

  const CHANNEL = {
    name: 'Solara Storefront',
    siteGroupId: '40188',
    siteType: 'B2B',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the catalog exactly the currency, name and language it was given', async () => {
    const { result } = mountWith({});

    await act(async () => {
      await result.current.createCommerceSetup({ catalog: CATALOG });
    });

    expect(callTo('/create-catalog')[1]).toMatchObject({
      currencyCode: 'EUR',
      defaultLanguageId: 'en_US',
      name: 'Solara Moto',
    });
  });

  it('sends the channel the site and the site type the dialog collected', async () => {
    const { result } = mountWith({});

    await act(async () => {
      await result.current.createCommerceSetup({
        catalog: CATALOG,
        channel: CHANNEL,
      });
    });

    expect(callTo('/create-channel')[1]).toMatchObject({
      name: 'Solara Storefront',
      siteGroupId: '40188',
      siteType: 'B2B',
    });
  });

  /**
   * The channel's currency is the *catalog Liferay made*, not the one that was
   * asked for. Had Liferay created the catalog in something else, a channel
   * built from the request would be the mismatched pair the dialog exists to
   * prevent. A test asserting only "EUR was sent" would pass either way.
   */
  it('gives the channel the currency the catalog came back with, not the one requested', async () => {
    const { result } = mountWith(
      {},
      {
        catalogResponse: {
          success: true,
          catalog: { ...CREATED_CATALOG, currencyCode: 'GBP' },
        },
      }
    );

    await act(async () => {
      await result.current.createCommerceSetup({
        catalog: CATALOG,
        channel: CHANNEL,
      });
    });

    expect(callTo('/create-channel')[1].currencyCode).toBe('GBP');
    expect(loggedMessages().join('\n')).toMatch(
      /catalog was asked for in EUR but was created in GBP/
    );
  });

  it('gives a channel-only create the selected catalog’s currency', async () => {
    const { result } = mountWith(
      { catalogId: 41002 },
      { catalogs: [{ id: 41002, name: 'Solara Moto', currencyCode: 'EUR' }] }
    );

    await act(async () => {
      await result.current.loadRootLists();
    });

    await act(async () => {
      await result.current.createCommerceSetup({ channel: CHANNEL });
    });

    expect(callTo('/create-channel')[1].currencyCode).toBe('EUR');
  });

  it('refuses a channel-only create when the selected catalog names no currency', async () => {
    const { result } = mountWith(
      { catalogId: 55000 },
      { catalogs: [{ id: 55000, name: 'Currencyless' }] }
    );

    await act(async () => {
      await result.current.loadRootLists();
    });

    await act(async () => {
      await result.current.createCommerceSetup({ channel: CHANNEL });
    });

    expect(callTo('/create-channel')).toBeUndefined();
    expect(notifyUser).toHaveBeenCalledWith(
      expect.stringMatching(/No currency could be determined/i),
      'danger'
    );
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])(
    'refuses when the catalog currency is %s, instead of substituting one',
    async (_label, currencyCode) => {
      const { result } = mountWith({});

      await act(async () => {
        await result.current.createCommerceSetup({
          catalog: { ...CATALOG, currencyCode },
        });
      });

      expect(callTo('/create-catalog')).toBeUndefined();
      expect(notifyUser).toHaveBeenCalledWith(
        expect.stringMatching(/No currency could be determined/i),
        'danger'
      );
      expect(loggedMessages().join('\n')).toMatch(
        /No currency could be determined/i
      );
    }
  );

  it('never invents USD when no currency was stated', async () => {
    const { result } = mountWith({});

    await act(async () => {
      await result.current.createCommerceSetup({
        catalog: { ...CATALOG, currencyCode: '' },
        channel: CHANNEL,
      });
    });

    expect(JSON.stringify(api.post.mock.calls)).not.toContain('USD');
  });

  it('creates nothing when neither half was asked for', async () => {
    const { result } = mountWith({});

    let outcome;
    await act(async () => {
      outcome = await result.current.createCommerceSetup({});
    });

    expect(outcome).toMatchObject({ reason: 'nothing-requested' });
    expect(callTo('/create-catalog')).toBeUndefined();
    expect(callTo('/create-channel')).toBeUndefined();
  });

  it('reports the currency the channel came back with, not the one sent', async () => {
    const { result } = mountWith(
      {},
      {
        channelResponse: {
          success: true,
          channel: { ...CREATED_CHANNEL, currencyCode: 'USD' },
        },
      }
    );

    await act(async () => {
      await result.current.createCommerceSetup({
        catalog: CATALOG,
        channel: CHANNEL,
      });
    });

    const messages = loggedMessages().join('\n');
    expect(messages).toMatch(/channel was asked for in EUR/);
    expect(messages).toMatch(/was created in USD/);
    expect(messages).toMatch(/currency the prices are not written in/);
  });

  it('stays quiet about a substitution when there was none', async () => {
    const { result } = mountWith({});

    await act(async () => {
      await result.current.createCommerceSetup({
        catalog: CATALOG,
        channel: CHANNEL,
      });
    });

    expect(loggedMessages().join('\n')).not.toMatch(/but was created in/);
  });

  /**
   * A new channel *displays* B2C while storing nothing, so the route reads the
   * type back. `applied: false` is the case that must reach the operator - it
   * is the one where the write was accepted and the value is not there.
   */
  it('says so when the site type was accepted but did not persist', async () => {
    const { result } = mountWith(
      {},
      {
        channelResponse: {
          success: true,
          channel: CREATED_CHANNEL,
          siteType: {
            applied: false,
            reason: 'unconfirmed',
            requested: 'B2B',
            message:
              'The commerce site type B2B was accepted but reads back as unset.',
          },
        },
      }
    );

    await act(async () => {
      await result.current.createCommerceSetup({
        catalog: CATALOG,
        channel: CHANNEL,
      });
    });

    expect(addLog).toHaveBeenCalledWith(
      expect.stringMatching(/accepted but reads back as unset/),
      'warning'
    );
  });

  it('reports the site type the instance holds when it did persist', async () => {
    const { result } = mountWith(
      {},
      {
        channelResponse: {
          success: true,
          channel: CREATED_CHANNEL,
          siteType: {
            applied: true,
            reason: 'confirmed',
            requested: 'B2B',
            siteTypeLabel: 'B2B',
          },
        },
      }
    );

    await act(async () => {
      await result.current.createCommerceSetup({
        catalog: CATALOG,
        channel: CHANNEL,
      });
    });

    expect(addLog).toHaveBeenCalledWith(
      expect.stringMatching(/site type reads back as B2B/),
      'info'
    );
    expect(loggedMessages().join('\n')).not.toMatch(/did not persist/);
  });

  it('reports a failed create rather than reporting success', async () => {
    const { result } = mountWith(
      {},
      { catalogResponse: { success: false, error: 'Catalog name in use' } }
    );

    let outcome;
    await act(async () => {
      outcome = await result.current.createCommerceSetup({ catalog: CATALOG });
    });

    expect(outcome.success).toBe(false);
    expect(notifyUser).toHaveBeenCalledWith(
      expect.stringMatching(/Catalog name in use/),
      'danger'
    );
    expect(callTo('/create-channel')).toBeUndefined();
  });
});

/**
 * The catalog owns the currency (#746).
 *
 * Price lists are written into the catalog and denominated by
 * `config.currencyCode`, so the field has to be the catalog's. It used to have
 * two writers and no owner: the channel wrote it on every selection, which is
 * how euro price lists ended up inside a dollar catalog.
 */
describe('useCommerceData: the catalog owns the currency (#746)', () => {
  const CATALOGS = [
    { id: 33941, name: 'Master', currencyCode: 'USD' },
    { id: 41002, name: 'Solara Moto', currencyCode: 'EUR' },
    { id: 55000, name: 'Currencyless' },
  ];

  const mount = (config = {}, { channels = [] } = {}) => {
    const setConfig = vi.fn();

    useApp.mockReturnValue({
      config: { liferayUrl: 'http://localhost:8080', ...config },
      setConfig,
      getLanguages: vi.fn().mockResolvedValue({ languages: [] }),
      getCurrencies: vi.fn().mockResolvedValue({ currencies: [] }),
    });
    useApi.mockReturnValue({
      post: vi.fn(async (path) => {
        if (path.endsWith('/get-catalogs')) return { catalogs: CATALOGS };
        if (path.endsWith('/get-channels')) return { channels };
        return {};
      }),
      get: vi.fn().mockResolvedValue({}),
    });

    const { result } = renderHook(() =>
      useCommerceData({
        addLog: vi.fn(),
        setConnectionEstablished: vi.fn(),
        setAiKeyAvailable: vi.fn(),
        setAiMediaKeyAvailable: vi.fn(),
        setConnectionErrors: vi.fn(),
        setProgress: vi.fn(),
      })
    );

    return { result, setConfig };
  };

  const nextConfigFrom = (setConfig, prev) =>
    setConfig.mock.calls.at(-1)[0](prev);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adopts the catalog’s currency when one is selected', async () => {
    const { result, setConfig } = mount();

    await act(async () => {
      await result.current.loadRootLists();
    });

    act(() => {
      result.current.selectCatalog('41002');
    });

    expect(nextConfigFrom(setConfig, { currencyCode: 'USD' })).toMatchObject({
      catalogId: 41002,
      currencyCode: 'EUR',
    });
  });

  it('keeps what is set when the catalog reports no currency', async () => {
    const { result, setConfig } = mount();

    await act(async () => {
      await result.current.loadRootLists();
    });

    act(() => {
      result.current.selectCatalog('55000');
    });

    expect(nextConfigFrom(setConfig, { currencyCode: 'EUR' })).toMatchObject({
      catalogId: 55000,
      currencyCode: 'EUR',
    });
  });

  /**
   * The behaviour this change exists to remove. Selecting a USD channel against
   * the EUR catalog used to rewrite the run to USD, and the price lists went
   * into the EUR catalog denominated in dollars.
   */
  it('no longer takes the run currency from the channel', async () => {
    const { result, setConfig } = mount(
      { currencyCode: 'EUR' },
      { channels: [{ id: 900, name: 'Web Store', currencyCode: 'USD' }] }
    );

    await act(async () => {
      await result.current.loadRootLists();
    });

    await act(async () => {
      await result.current.selectChannel('900');
    });

    expect(
      nextConfigFrom(setConfig, {
        currencyCode: 'EUR',
        selectedLanguages: [],
      }).currencyCode
    ).toBe('EUR');
  });

  it('loads the currencies without needing a channel, so a fresh instance can create one', async () => {
    const getCurrencies = vi
      .fn()
      .mockResolvedValue({ currencies: [{ code: 'EUR', name: 'Euro' }] });

    useApp.mockReturnValue({
      config: { liferayUrl: 'http://localhost:8080' },
      setConfig: vi.fn(),
      getLanguages: vi.fn().mockResolvedValue({ languages: [] }),
      getCurrencies,
    });
    useApi.mockReturnValue({
      post: vi
        .fn()
        .mockResolvedValue({ catalogs: [], channels: [], sites: [] }),
      get: vi.fn().mockResolvedValue({}),
    });

    const { result } = renderHook(() =>
      useCommerceData({
        addLog: vi.fn(),
        setConnectionEstablished: vi.fn(),
        setAiKeyAvailable: vi.fn(),
        setAiMediaKeyAvailable: vi.fn(),
        setConnectionErrors: vi.fn(),
        setProgress: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.loadRootLists();
    });

    expect(getCurrencies).toHaveBeenCalled();
    expect(result.current.currencies).toEqual([{ code: 'EUR', name: 'Euro' }]);
  });

  it('lists the sites a channel can be attached to', async () => {
    useApp.mockReturnValue({
      config: { liferayUrl: 'http://localhost:8080' },
      setConfig: vi.fn(),
      getLanguages: vi.fn().mockResolvedValue({ languages: [] }),
      getCurrencies: vi.fn().mockResolvedValue({ currencies: [] }),
    });
    useApi.mockReturnValue({
      post: vi.fn(async (path) =>
        path.endsWith('/get-sites')
          ? { sites: [{ id: 40188, name: 'Solara' }] }
          : { catalogs: [], channels: [] }
      ),
      get: vi.fn().mockResolvedValue({}),
    });

    const { result } = renderHook(() =>
      useCommerceData({
        addLog: vi.fn(),
        setConnectionEstablished: vi.fn(),
        setAiKeyAvailable: vi.fn(),
        setAiMediaKeyAvailable: vi.fn(),
        setConnectionErrors: vi.fn(),
        setProgress: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.loadRootLists();
    });

    expect(result.current.sites).toEqual([{ id: 40188, name: 'Solara' }]);
  });
});

/**
 * Clearing a channel must not clear a currency nobody asked to clear (#745).
 *
 * An imported configuration states a currency of its own. When the channel it
 * names is not on this instance, the channel goes and the currency used to go
 * with it - which is how a EUR configuration reached the create route carrying
 * nothing at all.
 */
describe('useCommerceData: clearing the channel selection (#745)', () => {
  const mount = () => {
    const setConfig = vi.fn();

    useApp.mockReturnValue({
      config: { liferayUrl: 'http://localhost:8080', currencyCode: 'EUR' },
      setConfig,
      getLanguages: vi.fn().mockResolvedValue({ languages: [] }),
      getCurrencies: vi.fn().mockResolvedValue({ currencies: [] }),
    });
    useApi.mockReturnValue({
      post: vi.fn().mockResolvedValue({ catalogs: [], channels: [] }),
      get: vi.fn().mockResolvedValue({}),
    });

    const { result } = renderHook(() =>
      useCommerceData({
        addLog: vi.fn(),
        setConnectionEstablished: vi.fn(),
        setAiKeyAvailable: vi.fn(),
        setAiMediaKeyAvailable: vi.fn(),
        setConnectionErrors: vi.fn(),
        setProgress: vi.fn(),
      })
    );

    return { result, setConfig };
  };

  const nextConfigFrom = (setConfig) => {
    const updater = setConfig.mock.calls.at(-1)[0];
    return updater({ currencyCode: 'EUR', channelId: '99' });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the currency the caller states while clearing the channel', async () => {
    const { result, setConfig } = mount();

    await act(async () => {
      await result.current.selectChannel(null, { currencyCode: 'EUR' });
    });

    const next = nextConfigFrom(setConfig);
    expect(next.channelId).toBeNull();
    expect(next.selectedLanguages).toEqual([]);
    expect(next.currencyCode).toBe('EUR');
  });

  it('clears the currency when the caller states none', async () => {
    const { result, setConfig } = mount();

    await act(async () => {
      await result.current.selectChannel(null);
    });

    expect(nextConfigFrom(setConfig).currencyCode).toBe('');
  });
});
