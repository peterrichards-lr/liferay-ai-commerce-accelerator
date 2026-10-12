import { http, HttpResponse } from 'msw';

export const handlers = [
  // Health / Connection
  http.post('http://localhost:3001/api/v1/test-connection', () => {
    return HttpResponse.json({
      success: true,
      message: 'Connected to Liferay.',
      openAiKeyAvailable: true,
      liferayUrl: 'http://liferay-test:8080',
    });
  }),

  // Root Lists - Catalogs
  http.post('http://localhost:3001/api/v1/get-catalogs', () => {
    return HttpResponse.json({
      catalogs: [{ id: 123, name: 'Default Catalog' }],
    });
  }),

  // Root Lists - Channels
  http.post('http://localhost:3001/api/v1/get-channels', () => {
    return HttpResponse.json({
      channels: [{ id: 456, name: 'Default Channel', siteGroupId: 789 }],
    });
  }),

  // Root Lists - Languages
  http.post('http://localhost:3001/api/v1/get-languages', () => {
    return HttpResponse.json({
      languages: [
        { id: 'en_US', name: 'English (United States)', isDefault: true },
      ],
    });
  }),

  // Root Lists - Currencies
  http.post('http://localhost:3001/api/v1/get-currencies', () => {
    return HttpResponse.json({
      currencies: [{ code: 'USD', name: 'US Dollar', isDefault: true }],
    });
  }),

  // Config - Categories
  http.get('http://localhost:3001/api/v1/config/categories', () => {
    return HttpResponse.json([
      { key: 'Electronics', label: 'Electronics' },
      { key: 'Clothing', label: 'Clothing' },
    ]);
  }),

  // Config - AI
  http.get('http://localhost:3001/api/v1/config/ai', () => {
    return HttpResponse.json({ success: true, config: { ai: {} } });
  }),

  // Config - Generation Limits
  http.get('http://localhost:3001/api/v1/config/generation-limits', () => {
    return HttpResponse.json({
      success: true,
      limits: {
        maxProducts: 100,
        maxAccounts: 50,
        maxOrders: 200,
        defaultOrderDistribution: {
          open: 5,
          processing: 5,
          shipped: 10,
          completed: 30,
        },
      },
    });
  }),

  // Config - Batch Sizes
  http.get('http://localhost:3001/api/v1/config/batch-sizes', () => {
    return HttpResponse.json([10, 25, 50, 100]);
  }),

  // Config - AI Model Options
  http.get('http://localhost:3001/api/v1/config/ai-model-options', () => {
    return HttpResponse.json([{ label: 'Mock Model', value: 'mock-model' }]);
  }),

  // Workflow - Start Generation
  http.post('http://localhost:3001/api/v1/generate/workflow', () => {
    return HttpResponse.json({
      sessionId: 'sess-mock-123',
      message: 'Generation workflow started successfully.',
    });
  }),

  // Workflow - Sessions
  http.get('http://localhost:3001/api/v1/workflows/sessions', () => {
    return HttpResponse.json([
      {
        session_id: 'sess-mock-123',
        flow_type: 'products',
        status: 'running',
        created_at: new Date().toISOString(),
      },
    ]);
  }),

  // Workflow - Session Events
  http.get(
    'http://localhost:3001/api/v1/workflows/sessions/:sessionId/events',
    () => {
      return HttpResponse.json({
        success: true,
        events: [
          {
            id: 1,
            timestamp: new Date().toISOString(),
            status: 'STARTED',
            message: 'Workflow started',
          },
        ],
      });
    }
  ),

  // Logs - Settings
  http.post('http://localhost:3001/api/v1/logs/settings', () => {
    return HttpResponse.json({
      success: true,
      config: {
        enabled: true,
        retentionCount: 10,
        autoCycleTime: '00:00',
      },
    });
  }),

  // Logs - Update Settings
  http.put('http://localhost:3001/api/v1/logs/settings', () => {
    return HttpResponse.json({
      success: true,
      message: 'Log management settings updated',
    });
  }),

  // Logs - Cycle
  http.post('http://localhost:3001/api/v1/logs/cycle', () => {
    return HttpResponse.json({
      success: true,
      message: 'Logs cycled successfully',
    });
  }),

  /**
   * The CORS preflight, which msw 3 intercepts and msw 2 did not.
   *
   * The frontend is served by Liferay and calls the microservice on another
   * origin, so happy-dom sends an `OPTIONS` before each of these. Under msw 2
   * that never reached a handler; under msw 3 it does, and an unanswered
   * preflight goes to the real network, where nothing is listening on 3001.
   * The request that mattered then failed as a `NetworkError` and the
   * component rendered its disconnected state - which is what #1233 saw.
   *
   * Answering it permissively is right for a mock: what the real microservice
   * allows is its own concern and is covered on that side by
   * `exposedHeaders.test.cjs`. This exists so the request under test survives
   * its preflight, not to assert a policy.
   */
  http.options('http://localhost:3001/*', () => {
    return new HttpResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }),

  /**
   * The two below were added with `server.use()` inside `beforeAll` in
   * `setupTests.js`, which meant `resetHandlers()` in `afterEach` removed them
   * after the first test of every file. They belong in the initial set, which
   * `resetHandlers()` restores to rather than clears.
   */
  http.get('*/api/v1/config/ai', () => {
    return HttpResponse.json({ success: true, config: { ai: {} } });
  }),

  http.get('*/', () => {
    return HttpResponse.json({});
  }),
];
