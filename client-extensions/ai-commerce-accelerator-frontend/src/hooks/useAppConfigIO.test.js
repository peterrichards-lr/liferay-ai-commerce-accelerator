import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useAppConfigIO from './useAppConfigIO';
import notifyUser from '../utils/notifications';
import { exportJsonFile } from '../utils/fileHelper';

vi.mock('../utils/notifications', () => ({ default: vi.fn() }));

vi.mock('../utils/fileHelper', () => ({
  buildFilename: vi.fn(() => 'config.json'),
  exportJsonFile: vi.fn(),
}));

const CATALOGS = [
  { id: 101, name: 'Default Catalog' },
  { id: 102, name: 'Spare Parts' },
];

const CHANNELS = [
  { id: 201, name: 'Default Channel', siteGroupId: 301 },
  { id: 202, name: 'Wholesale', siteGroupId: 302 },
];

const CONNECTED_CONFIG = {
  liferayUrl: 'http://localhost:8080',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  catalogId: 101,
  channelId: 201,
  siteGroupId: 301,
  currencyCode: 'USD',
  selectedLanguages: ['en_US'],
};

const renderIO = (overrides = {}) => {
  const setConfig = vi.fn();
  const selectChannel = vi.fn().mockResolvedValue(undefined);

  const props = {
    config: CONNECTED_CONFIG,
    setConfig,
    generationConfig: { productCount: 5 },
    setGenerationConfig: vi.fn(),
    connectionEstablished: true,
    setConnectionEstablished: vi.fn(),
    setOpenAiKeyAvailable: vi.fn(),
    setAiMediaKeyAvailable: vi.fn(),
    availableCategories: [],
    catalogs: CATALOGS,
    channels: CHANNELS,
    mountedRef: { current: true },
    selectChannel,
    ...overrides,
  };

  const { result } = renderHook(() => useAppConfigIO(props));

  return { result, setConfig, selectChannel };
};

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

const messagesSentTo = (mock) => mock.mock.calls.map(([message]) => message);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exportConfiguration', () => {
  it('writes the catalog and channel names beside their ids', () => {
    const { result } = renderIO();

    result.current.exportConfiguration();

    const [exported] = exportJsonFile.mock.calls[0];

    expect(exported).toMatchObject({
      catalogId: 101,
      catalogName: 'Default Catalog',
      channelId: 201,
      channelName: 'Default Channel',
    });
  });

  it('omits the names when the lists are not loaded', () => {
    const { result } = renderIO({ catalogs: [], channels: [] });

    result.current.exportConfiguration();

    const [exported] = exportJsonFile.mock.calls[0];

    expect(exported.catalogName).toBeUndefined();
    expect(exported.channelName).toBeUndefined();
  });
});

describe('importConfiguration reference resolution', () => {
  it('keeps the imported ids when they exist here, and says nothing about them', async () => {
    const { result, setConfig, selectChannel } = renderIO();

    const applied = await importJson(result, setConfig, {
      catalogId: 102,
      catalogName: 'Default Catalog',
      channelId: 202,
      channelName: 'Default Channel',
    });

    expect(applied.catalogId).toBe(102);
    expect(applied.channelId).toBe(202);

    await waitFor(() => expect(selectChannel).toHaveBeenCalled());
    expect(selectChannel).toHaveBeenCalledWith(202, expect.any(Object));

    expect(messagesSentTo(notifyUser)).toEqual([
      'Configuration imported successfully! Connection maintained.',
    ]);
  });

  it('remaps a dead id onto the entity of the same name, and reports it', async () => {
    const { result, setConfig, selectChannel } = renderIO();

    const applied = await importJson(result, setConfig, {
      catalogId: 34205,
      catalogName: 'Spare Parts',
      channelId: 34907,
      channelName: 'Wholesale',
    });

    expect(applied.catalogId).toBe(102);
    expect(applied.channelId).toBe(202);

    await waitFor(() =>
      expect(selectChannel).toHaveBeenCalledWith(202, {
        selectedLanguages: ['en_US'],
        currencyCode: 'USD',
      })
    );

    const messages = messagesSentTo(notifyUser);
    expect(messages[0]).toContain('Catalog id 34205 does not exist here');
    expect(messages[0]).toContain("'Spare Parts'");
    expect(messages[1]).toContain('Channel id 34907 does not exist here');
    expect(messages[1]).toContain("'Wholesale'");
  });

  it('clears a selection that resolves to nothing, and says so', async () => {
    const { result, setConfig, selectChannel } = renderIO();

    const applied = await importJson(result, setConfig, {
      catalogId: 34205,
      catalogName: 'Retired Catalog',
      channelId: 34907,
      channelName: 'Retired Channel',
    });

    expect(applied.catalogId).toBeNull();
    expect(applied.channelId).toBeNull();

    await waitFor(() => expect(selectChannel).toHaveBeenCalledWith(null));

    const messages = messagesSentTo(notifyUser);
    expect(messages[0]).toContain('Catalog');
    expect(messages[0]).toContain('was not found on this instance');
    expect(messages[1]).toContain('Channel');
    expect(messages[1]).toContain('was not found on this instance');
  });

  it('leaves the ids alone when there is no list to resolve against', async () => {
    const { result, setConfig } = renderIO({ catalogs: [], channels: [] });

    const applied = await importJson(result, setConfig, {
      catalogId: 34205,
      catalogName: 'Spare Parts',
      channelId: 34907,
      channelName: 'Wholesale',
    });

    expect(applied.catalogId).toBe(34205);
    expect(applied.channelId).toBe(34907);

    const messages = messagesSentTo(notifyUser);
    expect(messages[0]).toContain('could not be checked');
    expect(messages[1]).toContain('could not be checked');
  });

  it('resolves a configuration exported before names travelled with the ids', async () => {
    const { result, setConfig } = renderIO();

    const applied = await importJson(result, setConfig, {
      catalogId: 101,
      channelId: 201,
    });

    expect(applied.catalogId).toBe(101);
    expect(applied.channelId).toBe(201);
    expect(notifyUser).toHaveBeenCalledTimes(1);
  });
});

describe('importConfiguration ordering', () => {
  it('applies the imported fields before the channel is selected', async () => {
    const { result, setConfig, selectChannel } = renderIO();

    await importJson(result, setConfig, { channelId: 202 });
    await waitFor(() => expect(selectChannel).toHaveBeenCalled());

    expect(setConfig.mock.invocationCallOrder[0]).toBeLessThan(
      selectChannel.mock.invocationCallOrder[0]
    );
  });

  it('leaves the channel untouched when the import named none', async () => {
    const { result, setConfig, selectChannel } = renderIO({
      config: { ...CONNECTED_CONFIG, channelId: null, siteGroupId: null },
    });

    const applied = await importJson(result, setConfig, {
      currencyCode: 'GBP',
      selectedLanguages: ['en_GB'],
    });

    expect(applied.currencyCode).toBe('GBP');
    expect(applied.selectedLanguages).toEqual(['en_GB']);
    expect(selectChannel).not.toHaveBeenCalled();
  });

  it('hands the imported languages and currency to selectChannel', async () => {
    const { result, setConfig, selectChannel } = renderIO();

    await importJson(result, setConfig, {
      channelId: 202,
      channelName: 'Wholesale',
      currencyCode: 'GBP',
      selectedLanguages: ['en_GB', 'fr_FR'],
    });

    await waitFor(() =>
      expect(selectChannel).toHaveBeenCalledWith(202, {
        currencyCode: 'GBP',
        selectedLanguages: ['en_GB', 'fr_FR'],
      })
    );
  });

  it('reports a channel that cannot be loaded without claiming the import failed', async () => {
    const selectChannel = vi
      .fn()
      .mockRejectedValue(new Error('microservice unreachable'));
    const { result, setConfig } = renderIO({ selectChannel });

    await importJson(result, setConfig, { channelId: 202 });

    await waitFor(() =>
      expect(messagesSentTo(notifyUser)).toContain(
        'The imported configuration was applied, but the channel could not be loaded.'
      )
    );

    expect(messagesSentTo(notifyUser)).not.toContain(
      'Failed to import configuration. Invalid JSON file.'
    );
  });
});
