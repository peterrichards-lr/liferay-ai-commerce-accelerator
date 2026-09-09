const { AIService } = require('../services/aiService.cjs');
const { PromptService } = require('../services/promptService.cjs');
const { avoidProductsGuidance } = require('../utils/promptContext.cjs');
const { createProductLedger } = require('../utils/productLedger.cjs');

/**
 * A 50-product live run produced 49 products with 9 duplicated names and 6
 * duplicated base SKUs - five called "Keyed-Alike Lock System", four called
 * "BMW R1250GS Mounting Kit". The five chunks are independent model calls, and
 * only the top-up rounds deduplicated, so a repeat between two chunks went
 * straight through. See #798.
 */

describe('what counts as the same generated product', () => {
  const product = (name, baseSku) => ({
    baseSku,
    externalReferenceCode: `AICA-PRODUCT-${Math.random()}`,
    name: { en_US: name },
  });

  it('rejects a repeated name however different the base SKU', () => {
    const ledger = createProductLedger();

    expect(ledger.add(product('Keyed-Alike Lock System', 'LOCK-KA'))).toBe(
      true
    );
    expect(ledger.add(product('Keyed-Alike Lock System', 'KLS-UNIV'))).toBe(
      false
    );
  });

  it('rejects a repeated base SKU however different the name', () => {
    const ledger = createProductLedger();

    expect(ledger.add(product('BMW R1250GS Mount', 'MT-BMW-R1250GS'))).toBe(
      true
    );
    expect(ledger.add(product('BMW R1250GS Kit', 'MT-BMW-R1250GS'))).toBe(
      false
    );
  });

  it('accepts a product that shares neither', () => {
    const ledger = createProductLedger();

    ledger.add(product('Keyed-Alike Lock System', 'LOCK-KA'));

    expect(ledger.add(product('Auxiliary LED Lighting Kit', 'AUX-LED'))).toBe(
      true
    );
  });

  /**
   * The model builds a unique external reference code by construction, and
   * `generation.cjs` overwrites it with a fresh ERC anyway, so comparing on it
   * could only mask a real collision - which is exactly what the old
   * `baseSku || externalReferenceCode || name` precedence did.
   */
  it('ignores the external reference code', () => {
    const ledger = createProductLedger();
    const first = { externalReferenceCode: 'SAME', name: { en_US: 'One' } };
    const second = { externalReferenceCode: 'SAME', name: { en_US: 'Two' } };

    expect(ledger.add(first)).toBe(true);
    expect(ledger.add(second)).toBe(true);
  });

  it('compares names ignoring case and surrounding space', () => {
    const ledger = createProductLedger();

    ledger.add(product('Keyed-Alike Lock System', 'LOCK-KA'));

    expect(ledger.add(product('  keyed-alike LOCK system ', 'KLS'))).toBe(
      false
    );
  });

  it('reads the name from whatever language arrived', () => {
    const ledger = createProductLedger();

    expect(ledger.add({ name: { es_ES: 'Bolsa Lateral' } })).toBe(true);
    expect(ledger.add({ name: { es_ES: 'Bolsa Lateral' } })).toBe(false);
  });

  it('accepts a plain string name as well as a translated one', () => {
    const ledger = createProductLedger();

    expect(ledger.add({ name: 'Tank Bag' })).toBe(true);
    expect(ledger.add({ name: { en_US: 'Tank Bag' } })).toBe(false);
  });

  it('rejects a product with neither a name nor a base SKU', () => {
    const ledger = createProductLedger();

    expect(ledger.add({ externalReferenceCode: 'AICA-PRODUCT-1' })).toBe(false);
    expect(ledger.add({})).toBe(false);
  });

  it('compares a product identified by only one of the two', () => {
    const ledger = createProductLedger();

    expect(ledger.add({ name: { en_US: 'Tank Bag' } })).toBe(true);
    expect(ledger.add({ baseSku: 'TANK-BAG' })).toBe(true);
    expect(ledger.add({ baseSku: 'tank-bag' })).toBe(false);
  });
});

describe('the variety instruction a later chunk is given', () => {
  it('says nothing when nothing has been generated yet', () => {
    expect(avoidProductsGuidance(createProductLedger().avoid())).toBe('');
    expect(avoidProductsGuidance(undefined)).toBe('');
    expect(avoidProductsGuidance({ baseSkus: [], names: [] })).toBe('');
  });

  it('lists the names and base SKUs already used', () => {
    const ledger = createProductLedger();

    ledger.add({ baseSku: 'LOCK-KA', name: { en_US: 'Keyed-Alike Lock' } });
    ledger.add({ baseSku: 'AUX-LED', name: { en_US: 'Auxiliary LED Kit' } });

    const text = avoidProductsGuidance(ledger.avoid());

    expect(text).toContain('Product Variety');
    expect(text).toContain('Keyed-Alike Lock; Auxiliary LED Kit');
    expect(text).toContain('LOCK-KA; AUX-LED');
  });

  /**
   * `generation-limits` allows 10000 products and `_chatJson` aborts above
   * 15000 estimated tokens, so an uncapped list would abort the very large run
   * it was meant to improve.
   */
  it('caps the list so a very large run does not abort on prompt size', () => {
    const ledger = createProductLedger();

    for (let i = 0; i < 250; i++) {
      ledger.add({ baseSku: `SKU-${i}`, name: { en_US: `Product ${i}` } });
    }

    const text = avoidProductsGuidance(ledger.avoid());

    expect(text).toContain('Product 0');
    expect(text).toContain('Product 99');
    expect(text).not.toContain('Product 100');
    // Trimming the instruction does not weaken the rule.
    expect(
      ledger.add({ baseSku: 'SKU-249', name: { en_US: 'Anything' } })
    ).toBe(false);
  });

  it('records nothing for a product it rejected', () => {
    const ledger = createProductLedger();

    ledger.add({ baseSku: 'LOCK-KA', name: { en_US: 'Keyed-Alike Lock' } });
    ledger.add({ baseSku: 'KLS-UNIV', name: { en_US: 'Keyed-Alike Lock' } });

    expect(ledger.avoid().baseSkus).toEqual(['LOCK-KA']);
  });

  // The placeholder has to exist in the prompt for any of this to be sent.
  it('reaches the rendered product prompt', async () => {
    const ledger = createProductLedger();

    ledger.add({ baseSku: 'LOCK-KA', name: { en_US: 'Keyed-Alike Lock' } });

    const rendered = await new PromptService({
      logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
    }).render('product', {
      avoidProductsGuidance: avoidProductsGuidance(ledger.avoid()),
    });

    expect(rendered).toContain('Names already used: Keyed-Alike Lock');
    expect(rendered).not.toContain('{{avoidProductsGuidance}}');
  });
});

describe('the chunk loop no longer accumulates duplicates', () => {
  let aiService;
  let mockCtx;

  const named = (name) => ({ baseSku: name, name: { en_US: name } });

  beforeEach(async () => {
    mockCtx = {
      config: {
        getAIConfig: vi.fn().mockResolvedValue({
          defaultModel: 'gpt-4o-mini',
          mediaProvider: 'openai',
          provider: 'openai',
        }),
        getAIKey: vi.fn().mockResolvedValue('k'),
        getAIKeyCached: vi.fn().mockResolvedValue('k'),
        getAIMediaKey: vi.fn().mockResolvedValue('k'),
        getAIMediaKeyCached: vi.fn().mockResolvedValue('k'),
        getAIModelOptions: vi.fn().mockResolvedValue({
          aiModelOptions: [],
          defaultModel: 'gpt-4o-mini',
        }),
        getAISchema: vi.fn().mockResolvedValue({ type: 'object' }),
      },
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        trace: vi.fn(),
        warn: vi.fn(),
      },
      prompt: { render: vi.fn().mockResolvedValue('rendered prompt') },
    };

    aiService = new AIService(mockCtx);
    await aiService.initializeSchemas();

    vi.spyOn(aiService, 'getRuntimeAIConfig').mockResolvedValue({
      chunkSize: 10,
    });
  });

  const generate = (count) =>
    aiService.generateProductData('Accessories', count, {}, 'gpt-4o', [
      'en-US',
    ]);

  it('discards a chunk repeat and lets the top-up close the gap', async () => {
    const unique = (from, to) =>
      Array.from({ length: to - from }, (_, i) => named(`Product ${from + i}`));

    let call = 0;

    const chatJson = vi
      .spyOn(aiService, '_chatJson')
      .mockImplementation(async () => {
        call++;
        // Chunk two invents five of chunk one's products again, which is the
        // shape of the live run: independent calls, same obvious answers.
        if (call === 1) return unique(0, 10);
        if (call === 2) return [...unique(0, 5), ...unique(10, 15)];
        return unique(100 * call, 100 * call + 10);
      });

    const products = await generate(20);
    const names = products.map((product) => product.name.en_US);

    expect(products).toHaveLength(20);
    // Without the chunk-loop dedupe this returned 20 products of which five
    // were "Product 0" through "Product 4" twice over.
    expect(new Set(names).size).toBe(20);
    // Two chunks and one top-up round: the five discarded repeats widened the
    // shortfall the top-up closes rather than filling it with duplicates.
    expect(chatJson).toHaveBeenCalledTimes(3);
  });

  it('tells each chunk what the earlier chunks produced', async () => {
    let call = 0;

    vi.spyOn(aiService, '_chatJson').mockImplementation(async () => {
      call++;
      return [named(`Chunk ${call} Product`)];
    });

    await generate(20);

    const guidance = mockCtx.prompt.render.mock.calls.map(
      ([, vars]) => vars.avoidProductsGuidance
    );

    expect(guidance[0]).toBe('');
    expect(guidance[1]).toContain('Chunk 1 Product');
    expect(guidance[2]).toContain('Chunk 1 Product');
    expect(guidance[2]).toContain('Chunk 2 Product');
  });
});
