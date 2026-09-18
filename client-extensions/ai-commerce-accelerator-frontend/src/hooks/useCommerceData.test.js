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
 * Auto-Create Channel and the currency it applies (#745).
 *
 * The measured failure was a channel created in USD for a run configured as
 * EUR, with nothing on screen saying so. The currency was not wrong because
 * the default was badly chosen; it was wrong because something chose. So the
 * assertions here are about what the operator stated reaching Liferay
 * unaltered, about a refusal when they stated nothing, and about every
 * difference between what was asked for and what came back being said out
 * loud.
 */
describe('useCommerceData: Auto-Create Channel (#745)', () => {
  let addLog;
  let setConfig;
  let api;

  const CREATED = {
    id: 35094,
    name: 'AI Commerce Storefront',
    currencyCode: 'EUR',
  };

  const mountWith = (config, { createResponse = null } = {}) => {
    setConfig = vi.fn();
    addLog = vi.fn();

    api = {
      post: vi.fn(async (path) => {
        if (path.endsWith('/create-channel')) {
          return createResponse ?? { success: true, channel: CREATED };
        }
        return { catalogs: [], channels: [], warehouses: [] };
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

  const createCall = () =>
    api.post.mock.calls.find(([path]) => path.endsWith('/create-channel'));

  const loggedMessages = () => addLog.mock.calls.map(([message]) => message);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends the configured currency, so a EUR configuration makes a EUR channel', async () => {
    const { result } = mountWith({ currencyCode: 'EUR' });

    await act(async () => {
      await result.current.createDefaultChannel();
    });

    expect(createCall()[1]).toMatchObject({
      currencyCode: 'EUR',
      name: 'AI Commerce Storefront',
    });
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])(
    'refuses to create a channel when the currency is %s, instead of substituting one',
    async (_label, currencyCode) => {
      const { result } = mountWith({ currencyCode });

      await act(async () => {
        await result.current.createDefaultChannel();
      });

      expect(createCall()).toBeUndefined();
      expect(notifyUser).toHaveBeenCalledWith(
        expect.stringMatching(/cannot be created without choosing one/i),
        'danger'
      );
      expect(loggedMessages().join('\n')).toMatch(/No currency is set/i);
    }
  );

  it('never invents USD when no currency was stated', async () => {
    const { result } = mountWith({});

    await act(async () => {
      await result.current.createDefaultChannel();
    });

    expect(JSON.stringify(api.post.mock.calls)).not.toContain('USD');
  });

  it('reports the currency the channel came back with, not the one requested', async () => {
    const { result } = mountWith(
      { currencyCode: 'EUR' },
      {
        createResponse: {
          success: true,
          channel: { ...CREATED, currencyCode: 'USD' },
        },
      }
    );

    await act(async () => {
      await result.current.createDefaultChannel();
    });

    const messages = loggedMessages().join('\n');
    expect(messages).toMatch(/asked for in EUR but was created in USD/);
    expect(messages).toMatch(/makes USD this run's currency/);
  });

  it('stays quiet about a substitution when there was none', async () => {
    const { result } = mountWith({ currencyCode: 'EUR' });

    await act(async () => {
      await result.current.createDefaultChannel();
    });

    expect(loggedMessages().join('\n')).not.toMatch(/but was created in/);
  });

  it('says the name was AICA’s choice rather than the operator’s', async () => {
    const { result } = mountWith({ currencyCode: 'EUR' });

    await act(async () => {
      await result.current.createDefaultChannel();
    });

    const messages = loggedMessages().join('\n');
    expect(messages).toMatch(/Created channel 'AI Commerce Storefront'/);
    expect(messages).toMatch(/is AICA's, not one you chose/);
  });

  // #622: nothing in Headless sets the commerce site type, so this stays said.
  it('still warns that the channel has no commerce site type', async () => {
    const { result } = mountWith({ currencyCode: 'EUR' });

    await act(async () => {
      await result.current.createDefaultChannel();
    });

    expect(loggedMessages().join('\n')).toMatch(
      /no commerce site type set, so Liferay treats it as B2C/
    );
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
