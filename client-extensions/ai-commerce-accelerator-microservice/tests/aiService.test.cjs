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
        getAIModelOptions: vi.fn().mockResolvedValue({
          aiModelOptions: [
            { label: 'GPT-4o Mini', value: 'gpt-4o-mini', provider: 'openai' },
          ],
          defaultModel: 'gpt-4o-mini',
        }),
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

  it('should reject a model belonging to another provider', async () => {
    // Previously this reached the provider: openai would 404 midway through a
    // run and anthropic would silently substitute its own default model.
    mockCtx.config.getAIConfig.mockResolvedValue({
      provider: 'anthropic',
      defaultModel: 'gpt-4o-mini',
    });

    await expect(aiService.getRuntimeAIConfig({})).rejects.toThrow(
      /Anthropic Claude cannot run the model "gpt-4o-mini"/
    );
  });

  it('should attach a 400 to a provider/model mismatch', async () => {
    mockCtx.config.getAIConfig.mockResolvedValue({
      provider: 'gemini',
      defaultModel: 'claude-opus-5',
    });

    await expect(
      aiService.getRuntimeAIConfig({}).catch((e) => e.statusCode)
    ).resolves.toBe(400);
  });

  it('should allow an unrecognised model rather than blocking a custom one', async () => {
    mockCtx.config.getAIConfig.mockResolvedValue({
      provider: 'anthropic',
      defaultModel: 'my-self-hosted-llm',
    });

    const runtime = await aiService.getRuntimeAIConfig({});
    expect(runtime.model).toBe('my-self-hosted-llm');
  });

  it('should refuse to send a key that belongs to another provider', async () => {
    // The key is resolved generically, so nothing else stopped an OpenAI key
    // being transmitted to api.anthropic.com and disclosed there.
    mockCtx.config.getAIConfig.mockResolvedValue({
      provider: 'anthropic',
      defaultModel: 'claude-opus-5',
    });
    mockCtx.config.getAIKey.mockResolvedValue('sk-proj-SUPERSECRET');

    await expect(aiService.getRuntimeAIConfig({})).rejects.toThrow(
      /looks like OpenAI credentials/
    );
  });

  it('should not put the key in the error it raises', async () => {
    mockCtx.config.getAIConfig.mockResolvedValue({
      provider: 'anthropic',
      defaultModel: 'claude-opus-5',
    });
    mockCtx.config.getAIKey.mockResolvedValue('sk-proj-SUPERSECRET');

    const error = await aiService.getRuntimeAIConfig({}).catch((e) => e);
    expect(error.message).not.toContain('SUPERSECRET');
    expect(error.statusCode).toBe(400);
  });

  it('should allow an unrecognised key rather than blocking a proxy', async () => {
    mockCtx.config.getAIConfig.mockResolvedValue({
      provider: 'anthropic',
      defaultModel: 'claude-opus-5',
    });
    mockCtx.config.getAIKey.mockResolvedValue('my-gateway-token');
    mockCtx.config.getAIMediaKey.mockResolvedValue('my-gateway-token');

    const runtime = await aiService.getRuntimeAIConfig({});
    expect(runtime.credentials.apiKey).toBe('my-gateway-token');
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

  it('should chunk account generation when count exceeds chunkSizes.account', async () => {
    vi.spyOn(aiService, 'getRuntimeAIConfig').mockResolvedValue({
      chunkSizes: { account: 10 },
    });

    const chatJsonSpy = vi
      .spyOn(aiService, '_chatJson')
      .mockImplementation(async () => {
        return [
          { name: 'Acme Corp', externalReferenceCode: 'ACME' },
          { name: 'Beta Ltd', externalReferenceCode: 'BETA' },
        ];
      });

    const result = await aiService.generateAccountData(
      25,
      {},
      'gpt-4o',
      ['Industrial'],
      ['en-US']
    );

    expect(chatJsonSpy).toHaveBeenCalledTimes(3);
    expect(result.length).toBe(6);
  });

  it('should chunk order generation when count exceeds chunkSizes.order', async () => {
    vi.spyOn(aiService, 'getRuntimeAIConfig').mockResolvedValue({
      chunkSizes: { order: 10 },
    });

    const chatJsonSpy = vi
      .spyOn(aiService, '_chatJson')
      .mockImplementation(async () => {
        return [
          { externalReferenceCode: 'ORD-1', accountId: '101', items: [] },
          { externalReferenceCode: 'ORD-2', accountId: '102', items: [] },
        ];
      });

    const result = await aiService.generateOrderData(
      [{ id: '1', name: 'Item', sku: 'SKU1' }],
      [{ id: '101', name: 'Acme' }],
      25,
      {},
      'gpt-4o',
      ['en-US']
    );

    expect(chatJsonSpy).toHaveBeenCalledTimes(3);
    expect(result.length).toBe(6);
  });

  it('should chunk warehouse generation when count exceeds chunkSizes.warehouse', async () => {
    vi.spyOn(aiService, 'getRuntimeAIConfig').mockResolvedValue({
      chunkSizes: { warehouse: 10 },
    });

    const chatJsonSpy = vi
      .spyOn(aiService, '_chatJson')
      .mockImplementation(async () => {
        return [
          { externalReferenceCode: 'WH-1', name: { en_US: 'Warehouse 1' } },
          { externalReferenceCode: 'WH-2', name: { en_US: 'Warehouse 2' } },
        ];
      });

    const result = await aiService.generateWarehouseData(25, {}, 'gpt-4o', [
      'en-US',
    ]);

    expect(chatJsonSpy).toHaveBeenCalledTimes(3);
    expect(result.length).toBe(6);
  });
});

describe('AIService pricing chunking', () => {
  const { AIService } = require('../services/aiService.cjs');

  const makeProducts = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      name: `Product ${i + 1}`,
      sku: `SKU-${i + 1}`,
    }));

  const buildService = (chunkSize) => {
    const calls = [];
    const service = new AIService({
      logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
      prompt: { render: vi.fn().mockResolvedValue('rendered prompt') },
    });

    service.getRuntimeAIConfig = vi
      .fn()
      .mockResolvedValue({ chunkSizes: { pricing: chunkSize } });

    service._chatJson = vi.fn().mockImplementation(async () => {
      const index = calls.length;
      calls.push(index);
      return {
        priceListName: index === 0 ? 'Base Price List' : `Chunk ${index}`,
        priceEntries: [
          { sku: `entry-${index}-a` },
          { sku: `entry-${index}-b` },
        ],
      };
    });

    return { service, calls };
  };

  it('splits the product list into chunks and merges the entries', async () => {
    const { service, calls } = buildService(2);

    const result = await service.generatePricingData(
      makeProducts(5),
      'standard',
      { correlationId: 'c1' },
      'gpt-test'
    );

    // 5 products at a chunk size of 2 is three calls: 2, 2, 1.
    expect(calls).toHaveLength(3);
    expect(result.priceEntries).toHaveLength(6);
  });

  it('keeps the first priceListName, which the schema requires at the root', async () => {
    const { service } = buildService(2);

    const result = await service.generatePricingData(
      makeProducts(5),
      'standard',
      { correlationId: 'c1' },
      'gpt-test'
    );

    expect(result.priceListName).toBe('Base Price List');
  });

  it('does not chunk when the product list fits in one call', async () => {
    const { service, calls } = buildService(10);

    await service.generatePricingData(
      makeProducts(4),
      'standard',
      { correlationId: 'c1' },
      'gpt-test'
    );

    expect(calls).toHaveLength(1);
  });

  it('falls back to the default when the configured size is unusable', async () => {
    const { service, calls } = buildService(0);

    await service.generatePricingData(
      makeProducts(3),
      'standard',
      { correlationId: 'c1' },
      'gpt-test'
    );

    // 0 is falsy, so it falls through to the default of 10 rather than
    // producing a zero-width slice and an infinite loop. configService also
    // sanitises out-of-range values before they reach here.
    expect(calls).toHaveLength(1);
  });

  it('caps the chunk size at 50 however large the configured value', async () => {
    const { service, calls } = buildService(999);

    await service.generatePricingData(
      makeProducts(120),
      'standard',
      { correlationId: 'c1' },
      'gpt-test'
    );

    // 120 products capped at 50 per call is three chunks: 50, 50, 20.
    expect(calls).toHaveLength(3);
  });
});

describe('AIService mixed account ratio', () => {
  const { AIService } = require('../services/aiService.cjs');

  const buildService = (chunkSize = 100) => {
    const requests = [];
    const service = new AIService({
      logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
      prompt: {
        render: vi.fn(async (_name, vars) => {
          requests.push({ count: vars.count, accountType: vars.accountType });
          return 'rendered';
        }),
      },
    });

    service.getRuntimeAIConfig = vi
      .fn()
      .mockResolvedValue({ chunkSizes: { account: chunkSize } });

    service._chatJson = vi.fn(async () => ({ accounts: [{ name: 'acct' }] }));

    return { service, requests };
  };

  const generate = (service, count, options) =>
    service.generateAccountData(
      count,
      { correlationId: 'c1' },
      'gpt-test',
      [],
      ['en-US'],
      options
    );

  it('splits the count by the ratio and asks for each type separately', async () => {
    const { service, requests } = buildService();

    await generate(service, 10, {
      accountType: 'mixed',
      businessAccountRatio: 0.7,
    });

    expect(requests).toEqual([
      { count: 7, accountType: 'business' },
      { count: 3, accountType: 'person' },
    ]);
  });

  it('keeps the split exact rather than letting chunk rounding drift', async () => {
    // Chunk size 4 against 10 accounts: the ratio must still yield 7/3 overall,
    // not a per-chunk rounding of the ratio.
    const { service, requests } = buildService(4);

    await generate(service, 10, {
      accountType: 'mixed',
      businessAccountRatio: 0.7,
    });

    const business = requests
      .filter((r) => r.accountType === 'business')
      .reduce((sum, r) => sum + r.count, 0);
    const person = requests
      .filter((r) => r.accountType === 'person')
      .reduce((sum, r) => sum + r.count, 0);

    expect(business).toBe(7);
    expect(person).toBe(3);
    // 7 business chunks into 4+3 and 3 person fits one chunk.
    expect(requests).toHaveLength(3);
  });

  it('skips a portion entirely at the extremes of the range', async () => {
    const { service, requests } = buildService();

    await generate(service, 5, {
      accountType: 'mixed',
      businessAccountRatio: 1,
    });

    expect(requests).toEqual([{ count: 5, accountType: 'business' }]);
  });

  it('leaves the prompt to decide when no ratio is supplied', async () => {
    const { service, requests } = buildService();

    await generate(service, 6, { accountType: 'mixed' });

    // One request, still typed mixed, so the prompt's own mixed branch applies
    // exactly as it did before this feature.
    expect(requests).toEqual([{ count: 6, accountType: 'mixed' }]);
  });

  it('ignores the ratio for non-mixed account types', async () => {
    const { service, requests } = buildService();

    await generate(service, 4, {
      accountType: 'person',
      businessAccountRatio: 0.7,
    });

    expect(requests).toEqual([{ count: 4, accountType: 'person' }]);
  });
});
