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
      currencies: [{ id: 'USD', name: 'US Dollar', isDefault: true }],
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
];
