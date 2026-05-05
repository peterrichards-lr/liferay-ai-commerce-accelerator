const { AIService } = require('../services/aiService.cjs');

describe('AIService (Multi-Provider)', () => {
  let aiService;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      config: {
        getAIConfig: vi.fn().mockResolvedValue({
          provider: 'openai',
          mediaProvider: 'openai',
          defaultModel: 'gpt-4o-mini',
          temperature: 0.7,
        }),
        getAIKey: vi.fn().mockResolvedValue('test-text-key'),
        getAIMediaKey: vi.fn().mockResolvedValue('test-media-key'),
        getAISchema: vi.fn().mockResolvedValue({ type: 'object' }),
        getAIKeyCached: vi.fn().mockResolvedValue('test-text-key'),
        getAIMediaKeyCached: vi.fn().mockResolvedValue('test-media-key'),
      },
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
      },
      prompt: {
        render: vi.fn().mockResolvedValue('rendered prompt'),
      },
    };

    aiService = new AIService(mockCtx);
  });

  it('should resolve different providers for text and media', async () => {
    const textProvider = await aiService.getAIProvider({}, 'text');
    const mediaProvider = await aiService.getAIProvider({}, 'media');

    expect(textProvider).toBeDefined();
    expect(mediaProvider).toBeDefined();
  });

  it('should use media credentials for image generation', async () => {
    const runtime = await aiService.getRuntimeAIConfig({});
    expect(runtime.credentials.apiKey).toBe('test-text-key');
    expect(runtime.mediaCredentials.apiKey).toBe('test-media-key');
  });

  it('should fallback to core key if media key is missing', async () => {
    mockCtx.config.getAIMediaKey.mockResolvedValue(null);
    const runtime = await aiService.getRuntimeAIConfig({});
    expect(runtime.mediaCredentials.apiKey).toBe('test-text-key');
  });

  it('should support Gemini provider for text', async () => {
    mockCtx.config.getAIConfig.mockResolvedValue({
      provider: 'gemini',
      defaultModel: 'gemini-1.5-flash',
    });

    const provider = await aiService.getAIProvider({}, 'text');
    expect(provider.constructor.name).toBe('GeminiProvider');
  });

  it('should extract actual data from different response shapes', () => {
    const schemaName = 'product';

    // Case 1: Wrapped in "products"
    const resp1 = { products: [{ id: 1 }] };
    expect(aiService._getActualDataFromAIResponse(resp1, schemaName)).toEqual(
      resp1
    );

    // Case 2: Direct array
    const resp2 = [{ id: 1 }];
    expect(aiService._getActualDataFromAIResponse(resp2, schemaName)).toEqual(
      resp2
    );
  });

  it('should include grounding metadata in prompt variables', async () => {
    const options = {
      groundingMetadata: { languages: [{ id: 'en_US', name: 'English' }] },
      brandName: 'Test Brand',
    };

    // We mock _chatJson to avoid full provider execution
    const chatSpy = vi
      .spyOn(aiService, '_chatJson')
      .mockResolvedValue([{ name: 'AI Product' }]);

    await aiService.generateProductData(
      'Electronics',
      1,
      {},
      'gpt-4o',
      ['en-US'],
      options
    );

    expect(mockCtx.prompt.render).toHaveBeenCalledWith(
      'product',
      expect.objectContaining({
        brandName: 'Test Brand',
        groundingMetadata: options.groundingMetadata,
      }),
      expect.any(Object)
    );
  });
});
