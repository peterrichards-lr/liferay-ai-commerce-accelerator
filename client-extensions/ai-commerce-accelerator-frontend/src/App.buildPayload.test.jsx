import { render, waitFor } from '@testing-library/react';
import AppRoot from './App';

/**
 * What the four write flows put on the wire (#1044).
 *
 * `App.jsx` used to declare a `buildPayload` of its own returning
 * `{ ...config, ...generationConfig }`, and handed that to generate, import,
 * extract and media. So every one of those writes carried the client secret
 * whether or not it needed it, along with the display title, the subtitle, the
 * websocket logging level and the whole generator form.
 *
 * The hook's version names the fields it sends. These assert the four flows are
 * given that one and not another, because the shadow was invisible from every
 * hook's own test: each of them is handed `buildPayload` as a prop, so a mock
 * stands in for it and the App-level wiring is exactly what no hook test can
 * see.
 */

vi.mock('./components/data-generator/DataGeneratorForm', () => ({
  default: () => <div data-testid="generator-form" />,
}));

vi.mock('./components/dashboard/Dashboard', () => ({
  default: () => <div data-testid="dashboard" />,
}));

vi.mock('./hooks/useRealtimeWebSocket', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({
    wsRef: { current: null },
    wsConnected: false,
    reconnect: vi.fn(),
    ping: vi.fn(),
  }),
}));

const received = {};

vi.mock('./hooks/useGeneration', () => ({
  default: (props) => {
    received.generation = props;
    return {
      isSubmitting: false,
      generateData: vi.fn(),
      cancelWorkflow: vi.fn(),
    };
  },
}));

vi.mock('./hooks/useDatasetIO', () => ({
  default: (props) => {
    received.datasetIO = props;
    return {
      exportPackage: vi.fn(),
      exportSession: vi.fn(),
      extractPackage: vi.fn(),
      importDataset: vi.fn(),
      isTransferring: false,
    };
  },
}));

vi.mock('./hooks/useMediaGeneration', () => ({
  default: (props) => {
    received.media = props;
    return { generateMedia: vi.fn(), isSubmittingMedia: false };
  },
}));

const CONNECTED = {
  clientId: 'aica-client',
  clientSecret: 'aica-secret', // pragma: allowlist secret
  liferayUrl: 'https://target.example',
  microserviceUrl: 'http://localhost:3001',
  subtitle: 'Generate comprehensive Commerce data',
  title: 'Test Accelerator',
  wsLoggingLevel: 'debug',
};

const mountWith = async (config) => {
  render(<AppRoot config={config} />);
  await waitFor(() => expect(received.generation).toBeDefined());
};

describe('App hands the write flows one payload builder', () => {
  beforeEach(() => {
    delete received.generation;
    delete received.datasetIO;
    delete received.media;
  });

  it('gives generate, dataset IO and media the same builder', async () => {
    await mountWith(CONNECTED);

    expect(received.datasetIO.buildPayload).toBe(
      received.generation.buildPayload
    );
    expect(received.media.buildPayload).toBe(received.generation.buildPayload);
  });

  it('sends the named commerce and connection fields, and nothing else', async () => {
    await mountWith(CONNECTED);

    expect(Object.keys(received.generation.buildPayload()).sort()).toEqual([
      'aiModel',
      'batchSize',
      'catalogId',
      'channelId',
      'clientId',
      'clientSecret',
      'currencyCode',
      'languageId',
      'liferayUrl',
      'localeCode',
      'microserviceUrl',
      'pollingDelay',
      'pollingRetries',
      'selectedLanguages',
      'siteGroupId',
    ]);
  });

  it('leaves the display-only configuration at home', async () => {
    await mountWith(CONNECTED);

    const payload = received.generation.buildPayload();

    expect(payload).not.toHaveProperty('title');
    expect(payload).not.toHaveProperty('subtitle');
    expect(payload).not.toHaveProperty('wsLoggingLevel');
    expect(payload).not.toHaveProperty('liferayHosted');
    // Never had a value: the correlation id lives in AppContext and rides on
    // the request header, so `config.correlationId` was always undefined.
    expect(payload).not.toHaveProperty('correlationId');
  });

  it('leaves the generator form out of the flows that are not a generation', async () => {
    await mountWith(CONNECTED);

    const payload = received.datasetIO.buildPayload();

    expect(payload).not.toHaveProperty('productCount');
    expect(payload).not.toHaveProperty('orderCount');
    expect(payload).not.toHaveProperty('sessionName');
    expect(payload).not.toHaveProperty('imageMode');
    expect(payload).not.toHaveProperty('demoMode');
  });

  /**
   * AICA is routinely run separately from the Liferay it targets, so the
   * credentials genuinely travel - an OAuth ERC cannot be resolved from a
   * routes tree that is not there. What changed is that they travel by name
   * and only when there is a complete pair to send.
   */
  it('carries the credentials, since the target may be another instance', async () => {
    await mountWith(CONNECTED);

    expect(received.generation.buildPayload()).toMatchObject({
      clientId: 'aica-client',
      clientSecret: 'aica-secret', // pragma: allowlist secret
    });
  });

  it('sends neither half of an incomplete credential pair', async () => {
    await mountWith({ ...CONNECTED, clientSecret: '' });

    const payload = received.generation.buildPayload();

    expect(payload).not.toHaveProperty('clientId');
    expect(payload).not.toHaveProperty('clientSecret');
  });

  it('lets a flow decline the credentials outright', async () => {
    await mountWith(CONNECTED);

    const payload = received.generation.buildPayload({
      includeCredentials: false,
    });

    expect(payload).not.toHaveProperty('clientId');
    expect(payload).not.toHaveProperty('clientSecret');
  });

  it('hands the media flow the generation settings its route gates on', async () => {
    await mountWith(CONNECTED);

    expect(received.media.generationConfig).toMatchObject({
      imageMode: 'placeholder',
      pdfMode: 'placeholder',
    });
  });
});
