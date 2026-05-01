const { AIService } = require('../services/aiService.cjs');

describe('AIService', () => {
  let aiService;
  let mockCtx;

  beforeEach(() => {
    mockCtx = {
      config: {
        getAIConfig: vi.fn().mockResolvedValue({
          defaultModel: 'gpt-4o-mini',
          temperature: 0.7,
          maxTokens: 4000,
        }),
        getOpenAIKey: vi.fn().mockResolvedValue('test-key'),
        getAISchema: vi.fn().mockResolvedValue({ type: 'object' }),
      },
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
      },
      prompt: {
        render: vi.fn().mockResolvedValue('rendered-prompt'),
      },
    };
    aiService = new AIService(mockCtx);
  });

  it('should generate product data using mocked OpenAI', async () => {
    const result = await aiService.generateProductData(
      'Electronics',
      1,
      {},
      null,
      ['en-US']
    );

    expect(result.products).toHaveLength(1);
    expect(result.products[0].name.en_US).toBe('AI Product');
    expect(mockCtx.prompt.render).toHaveBeenCalledWith(
      'product',
      expect.any(Object),
      expect.any(Object)
    );
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

    // Case 3: Wrapped in properties (sometimes happens with specific prompts)
    const resp3 = { properties: { products: [{ id: 1 }] }, $schema: '...' };
    expect(aiService._getActualDataFromAIResponse(resp3, schemaName)).toEqual({
      products: [{ id: 1 }],
    });
  });
});
