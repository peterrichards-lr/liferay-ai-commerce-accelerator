import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import useCommerceData from './useCommerceData';
import { useApp, useApi } from '../context/AppContext';

vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
  useApi: vi.fn(),
}));

vi.mock('../utils/notifications', () => ({ default: vi.fn() }));

/**
 * The second connection on the wire (#824).
 *
 * It travels the hook's whitelisted `buildPayload` and nowhere else, which is
 * why #1044 had to land first: behind `App.jsx`'s old wholesale spread a second
 * credential set would have doubled what #820 exposed. These assert the shape
 * that leaves the browser, including the two cases where nothing may leave at
 * all.
 */
describe('buildPayload and the configuration source (#824)', () => {
  const mountWith = (config) => {
    useApp.mockReturnValue({
      config: { liferayUrl: 'https://uat.example', ...config },
      setConfig: vi.fn(),
      getLanguages: vi.fn().mockResolvedValue({ languages: [] }),
      getCurrencies: vi.fn().mockResolvedValue({ currencies: [] }),
    });
    useApi.mockReturnValue({
      post: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({}),
    });

    return renderHook(() =>
      useCommerceData({
        addLog: vi.fn(),
        setConnectionEstablished: vi.fn(),
        setAiKeyAvailable: vi.fn(),
        setAiMediaKeyAvailable: vi.fn(),
        setConnectionErrors: vi.fn(),
        setProgress: vi.fn(),
      })
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends no configuration source when the row is collapsed', () => {
    const { result } = mountWith({
      configSourceEnabled: false,
      configSourceUrl: 'http://localhost:8080',
      configSourceClientId: 'local-id',
      configSourceClientSecret: 'local-secret',
    });

    // A URL still in state but no longer on screen must not apply. That is the
    // shape of every silent-substitution bug on this issue.
    const payload = result.current.buildPayload();
    expect(payload.configSource).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('local-secret');
  });

  it('sends the configuration source with its own credentials when expanded', () => {
    const { result } = mountWith({
      configSourceEnabled: true,
      configSourceUrl: 'http://localhost:8080',
      configSourceClientId: 'local-id',
      configSourceClientSecret: 'local-secret',
    });

    expect(result.current.buildPayload().configSource).toEqual({
      liferayUrl: 'http://localhost:8080',
      clientId: 'local-id',
      clientSecret: 'local-secret',
    });
  });

  it('never sends half a credential', () => {
    const { result } = mountWith({
      configSourceEnabled: true,
      configSourceUrl: 'http://localhost:8080',
      configSourceClientId: 'local-id',
    });

    // Half a credential is not a credential; sending one produces an
    // authentication failure that reads as a wrong password.
    expect(result.current.buildPayload().configSource).toEqual({
      liferayUrl: 'http://localhost:8080',
    });
  });

  it('withholds the configuration credentials when credentials are withheld', () => {
    const { result } = mountWith({
      configSourceEnabled: true,
      configSourceUrl: 'http://localhost:8080',
      configSourceClientId: 'local-id',
      configSourceClientSecret: 'local-secret',
    });

    const payload = result.current.buildPayload({ includeCredentials: false });

    expect(payload.configSource).toEqual({
      liferayUrl: 'http://localhost:8080',
    });
    expect(JSON.stringify(payload)).not.toContain('local-secret');
  });

  it('does not let the configuration source become the write target', () => {
    const { result } = mountWith({
      configSourceEnabled: true,
      configSourceUrl: 'http://localhost:8080',
      configSourceClientId: 'local-id',
      configSourceClientSecret: 'local-secret',
      clientId: 'target-id',
      clientSecret: 'target-secret',
    });

    const payload = result.current.buildPayload();

    expect(payload.liferayUrl).toBe('https://uat.example');
    expect(payload.clientId).toBe('target-id');
  });

  it('ignores a blank URL even when the row is expanded', () => {
    const { result } = mountWith({
      configSourceEnabled: true,
      configSourceUrl: '   ',
    });

    expect(result.current.buildPayload().configSource).toBeUndefined();
  });
});
