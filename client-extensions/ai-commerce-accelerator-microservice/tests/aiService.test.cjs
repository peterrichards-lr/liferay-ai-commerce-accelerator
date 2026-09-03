const { AIService } = require('../services/aiService.cjs');

describe('AIService (Multi-Provider)', () => {
  let aiService;
  let mockCtx;

  beforeEach(async () => {
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
    await aiService.initializeSchemas();
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
    vi.spyOn(aiService, '_chatJson').mockResolvedValue([
      { name: 'AI Product' },
    ]);

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

  it('should default accountType to "business" when not specified', async () => {
    vi.spyOn(aiService, '_chatJson').mockResolvedValue([
      { name: 'AI Account' },
    ]);

    await aiService.generateAccountData(1, {}, 'gpt-4o', [], ['en-US'], {});

    expect(mockCtx.prompt.render).toHaveBeenCalledWith(
      'account',
      expect.objectContaining({ accountType: 'business' }),
      expect.any(Object)
    );
  });

  it('should pass through an explicit accountType to the account prompt', async () => {
    vi.spyOn(aiService, '_chatJson').mockResolvedValue([{ name: 'AI Rider' }]);

    await aiService.generateAccountData(1, {}, 'gpt-4o', [], ['en-US'], {
      accountType: 'person',
    });

    expect(mockCtx.prompt.render).toHaveBeenCalledWith(
      'account',
      expect.objectContaining({ accountType: 'person' }),
      expect.any(Object)
    );
  });

  it('should default orderDateRangeDays to 0 (today only) when not specified', async () => {
    vi.spyOn(aiService, '_chatJson').mockResolvedValue([{ accountId: '1' }]);

    await aiService.generateOrderData([], [], 1, {}, 'gpt-4o', ['en-US'], {});

    expect(mockCtx.prompt.render).toHaveBeenCalledWith(
      'order',
      expect.objectContaining({ orderDateRangeDays: 0 }),
      expect.any(Object)
    );
  });

  it('should pass through an explicit orderDateRangeDays to the order prompt', async () => {
    vi.spyOn(aiService, '_chatJson').mockResolvedValue([{ accountId: '1' }]);

    await aiService.generateOrderData([], [], 1, {}, 'gpt-4o', ['en-US'], {
      orderDateRangeDays: 90,
    });

    expect(mockCtx.prompt.render).toHaveBeenCalledWith(
      'order',
      expect.objectContaining({ orderDateRangeDays: 90 }),
      expect.any(Object)
    );
  });

  it('should abort and throw pre-flight guardrail error if token count exceeds safety limit', async () => {
    process.env.AICA_MAX_TOKEN_LIMIT = '5';
    process.env.ALLOW_LARGE_PROMPTS = 'false';

    const provider = {
      generateJSON: vi.fn().mockResolvedValue({}),
    };
    vi.spyOn(aiService, 'getAIProvider').mockResolvedValue(provider);

    await expect(
      aiService._chatJson('test', 'This prompt exceeds five tokens easily', {})
    ).rejects.toThrow(/Pre-flight Guardrail Aborted/);

    delete process.env.AICA_MAX_TOKEN_LIMIT;
    delete process.env.ALLOW_LARGE_PROMPTS;
  });

  it('should chunk product generation when count exceeds chunkSize', async () => {
    vi.spyOn(aiService, 'getRuntimeAIConfig').mockResolvedValue({
      chunkSize: 10,
    });

    const chatJsonSpy = vi
      .spyOn(aiService, '_chatJson')
      .mockImplementation(async (task, prompt, cfg, model, schema) => {
        // Return dummy products matching prompt request
        return [
          { name: { en_US: 'Product A' }, externalReferenceCode: 'PROD-A' },
          { name: { en_US: 'Product B' }, externalReferenceCode: 'PROD-B' },
        ];
      });

    const result = await aiService.generateProductData(
      'Electronics',
      25,
      {},
      'gpt-4o',
      ['en-US'],
      { categories: ['Laptops', 'Phones'] }
    );

    // 25 items with chunkSize 10 should produce 3 chunks (10, 10, 5)
    expect(chatJsonSpy).toHaveBeenCalledTimes(3);
    expect(result.length).toBe(6); // 2 items per mock call * 3 calls
  });
});
