import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useAppConfigIO from './useAppConfigIO';
import notifyUser from '../utils/notifications';
import { exportJsonFile } from '../utils/fileHelper';
import { getConfigurationSourceErrorsMap } from '../utils/validation';

vi.mock('../utils/notifications', () => ({ default: vi.fn() }));
vi.mock('../utils/fileHelper', () => ({ exportJsonFile: vi.fn() }));

/**
 * The configuration source in a saved configuration (#824 §4 and §5).
 *
 * It has to travel with the exported run parameters or the same pair of
 * instances cannot be replayed. The client id travels; the secret does not,
 * because a client id is an identifier and the secret is the credential, and a
 * saved configuration must not be a secret-bearing document (#820).
 */
const CONFIG = {
  liferayUrl: 'https://uat.example',
  clientId: 'target-id',
  clientSecret: 'target-secret',
  catalogId: 101,
  channelId: 201,
  configSourceEnabled: true,
  configSourceUrl: 'http://localhost:8080',
  configSourceClientId: 'local-id',
  configSourceClientSecret: 'local-secret',
};

const renderIO = (config) => {
  const setConfig = vi.fn();

  const { result } = renderHook(() =>
    useAppConfigIO({
      config,
      setConfig,
      generationConfig: {},
      setGenerationConfig: vi.fn(),
      connectionEstablished: true,
      setConnectionEstablished: vi.fn(),
      setOpenAiKeyAvailable: vi.fn(),
      setAiMediaKeyAvailable: vi.fn(),
      availableCategories: [],
      catalogs: [{ id: 101, name: 'Master' }],
      channels: [{ id: 201, name: 'Storefront', siteGroupId: 301 }],
      mountedRef: { current: true },
      selectChannel: vi.fn().mockResolvedValue(undefined),
    })
  );

  return { result, setConfig };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exporting a configuration source (#824)', () => {
  it('names the instance and the client id', () => {
    const { result } = renderIO(CONFIG);

    result.current.exportConfiguration();

    const [exported] = exportJsonFile.mock.calls[0];

    expect(exported).toMatchObject({
      configSourceEnabled: true,
      configSourceUrl: 'http://localhost:8080',
      configSourceClientId: 'local-id',
    });
  });

  it('never writes the client secret', () => {
    const { result } = renderIO(CONFIG);

    result.current.exportConfiguration();

    const [exported] = exportJsonFile.mock.calls[0];

    expect(JSON.stringify(exported)).not.toContain('local-secret');
    expect(exported.configSourceClientSecret).toBeUndefined();
  });

  it('writes no configuration source at all when the row is collapsed', () => {
    const { result } = renderIO({
      ...CONFIG,
      configSourceEnabled: false,
    });

    result.current.exportConfiguration();

    const [exported] = exportJsonFile.mock.calls[0];

    expect(exported.configSourceUrl).toBeUndefined();
    expect(exported.configSourceClientId).toBeUndefined();
  });
});

describe('importing a configuration source (#824)', () => {
  const importJson = async (result, setConfig, importedData) => {
    const file = new File([JSON.stringify(importedData)], 'config.json', {
      type: 'application/json',
    });

    result.current.importConfiguration({
      target: { files: [file], value: 'config.json' },
    });

    await waitFor(() => expect(setConfig).toHaveBeenCalled());

    return setConfig.mock.calls[0][0];
  };

  it('restores the instance and the client id', async () => {
    const { result, setConfig } = renderIO({
      ...CONFIG,
      configSourceEnabled: false,
    });

    const applied = await importJson(result, setConfig, {
      configSourceEnabled: true,
      configSourceUrl: 'http://elsewhere:8080',
      configSourceClientId: 'other-id',
    });

    expect(applied.configSourceUrl).toBe('http://elsewhere:8080');
    expect(applied.configSourceClientId).toBe('other-id');
  });

  it('refuses to take a client secret out of a file', async () => {
    const { result, setConfig } = renderIO({
      ...CONFIG,
      configSourceClientSecret: 'kept-in-session',
    });

    const applied = await importJson(result, setConfig, {
      configSourceEnabled: true,
      configSourceUrl: 'http://elsewhere:8080',
      configSourceClientSecret: 'from-a-file',
    });

    // Accepting one would let a hand-edited file reintroduce exactly the
    // secret-bearing document the export exists to avoid.
    expect(applied.configSourceClientSecret).toBe('kept-in-session');
  });

  it('says the secret has to be re-entered rather than letting a run find out', async () => {
    const { result, setConfig } = renderIO({
      ...CONFIG,
      configSourceClientSecret: '',
    });

    await importJson(result, setConfig, {
      configSourceEnabled: true,
      configSourceUrl: 'http://elsewhere:8080',
    });

    expect(notifyUser.mock.calls.map(([message]) => message).join(' ')).toMatch(
      /without its client secret/i
    );
  });
});

describe('getConfigurationSourceErrorsMap (#824)', () => {
  it('asks for nothing while the row is collapsed', () => {
    expect(
      getConfigurationSourceErrorsMap({ configSourceEnabled: false })
    ).toEqual({});
  });

  it('requires all three fields together once expanded', () => {
    const errors = getConfigurationSourceErrorsMap({
      configSourceEnabled: true,
    });

    expect(errors.configSourceUrl).toBeTruthy();
    expect(errors.configSourceClientId).toBeTruthy();
    expect(errors.configSourceClientSecret).toBeTruthy();
  });

  it('rejects a URL that is not absolute', () => {
    const errors = getConfigurationSourceErrorsMap({
      configSourceEnabled: true,
      configSourceUrl: 'localhost:8080',
      configSourceClientId: 'id',
      configSourceClientSecret: 'secret',
    });

    expect(errors.configSourceUrl).toBeTruthy();
    expect(errors.configSourceClientId).toBeUndefined();
  });

  it('is empty when the connection is complete', () => {
    expect(
      getConfigurationSourceErrorsMap({
        configSourceEnabled: true,
        configSourceUrl: 'http://localhost:8080',
        configSourceClientId: 'id',
        configSourceClientSecret: 'secret',
      })
    ).toEqual({});
  });
});
