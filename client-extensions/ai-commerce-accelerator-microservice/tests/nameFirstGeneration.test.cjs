const { AIService } = require('../services/aiService.cjs');
const { assignedNamesGuidance } = require('../utils/promptContext.cjs');

// #825: the chunks are not short, they are full of repeats the ledger then
// discards. Naming the catalogue up front converts "avoid this growing list"
// into "write these", which is a constraint the model can satisfy per item.

describe('assignedNamesGuidance', () => {
  it('renders nothing when no names are assigned', () => {
    expect(assignedNamesGuidance([])).toBe('');
    expect(assignedNamesGuidance(undefined)).toBe('');
    expect(assignedNamesGuidance([null, ''])).toBe('');
  });

  it('lists the names in order and says how many to return', () => {
    const text = assignedNamesGuidance(['Alpine Helmet', 'Pannier Liner']);

    expect(text).toContain('Generate exactly 2 products');
    expect(text).toContain('1. Alpine Helmet');
    expect(text).toContain('2. Pannier Liner');
  });
});

describe('Name-first product generation', () => {
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
  });

  const withNameFirst = (nameFirstProducts) =>
    vi.spyOn(aiService, 'getRuntimeAIConfig').mockResolvedValue({
      chunkSize: 10,
      nameFirstProducts,
    });

  const generate = (count) =>
    aiService.generateProductData('Accessories', count, {}, 'gpt-4o', [
      'en-US',
    ]);

  it('names the catalogue once, then elaborates the names in chunks', async () => {
    withNameFirst(true);

    let call = 0;
    vi.spyOn(aiService, '_chatJson').mockImplementation(async (task) => {
      call++;
      if (task === 'names') {
        return {
          names: Array.from({ length: 20 }, (_, i) => ({
            category: 'Accessories',
            name: `Name ${i}`,
          })),
        };
      }
      // Each product chunk elaborates the names it was handed.
      const chunk = call - 2;
      return Array.from({ length: 10 }, (_, i) =>
        named(`Name ${chunk * 10 + i}`)
      );
    });

    const products = await generate(20);

    expect(products).toHaveLength(20);

    const nameCalls = mockCtx.prompt.render.mock.calls.filter(
      ([template]) => template === 'names'
    );
    expect(nameCalls).toHaveLength(1);

    const productVars = mockCtx.prompt.render.mock.calls
      .filter(([template]) => template === 'product')
      .map(([, vars]) => vars);

    expect(productVars[0].assignedNamesGuidance).toContain('1. Name 0');
    expect(productVars[1].assignedNamesGuidance).toContain('1. Name 10');
  });

  it('stops sending an avoid list once the names carry distinctness', async () => {
    withNameFirst(true);

    vi.spyOn(aiService, '_chatJson').mockImplementation(async (task) => {
      if (task === 'names') {
        return {
          names: Array.from({ length: 20 }, (_, i) => ({
            category: 'Accessories',
            name: `Name ${i}`,
          })),
        };
      }
      return Array.from({ length: 10 }, (_, i) =>
        named(`P${i}${Math.random()}`)
      );
    });

    await generate(20);

    // The two instructions are alternatives, not additions. Sending both would
    // reintroduce the growing negative constraint name-first exists to remove.
    const productVars = mockCtx.prompt.render.mock.calls
      .filter(([template]) => template === 'product')
      .map(([, vars]) => vars);

    for (const vars of productVars) {
      expect(vars.avoidProductsGuidance).toBe('');
    }
  });

  it('deduplicates the returned names case-insensitively', async () => {
    withNameFirst(true);

    vi.spyOn(aiService, '_chatJson').mockImplementation(async (task) => {
      if (task === 'names') {
        return {
          names: [
            { category: 'A', name: 'Alpine Helmet' },
            { category: 'A', name: 'alpine helmet' },
            { category: 'A', name: '  Alpine Helmet  ' },
            { category: 'A', name: 'Pannier Liner' },
          ],
        };
      }
      return [named('Anything')];
    });

    const names = await aiService.generateProductNames(
      4,
      ['A'],
      {},
      'gpt-4o',
      {}
    );

    // A repeat here is spent twice: once naming it, once elaborating it.
    expect(names.map((entry) => entry.name)).toEqual([
      'Alpine Helmet',
      'Pannier Liner',
    ]);
  });

  it('says up front when the names cannot reach the requested count', async () => {
    withNameFirst(true);

    vi.spyOn(aiService, '_chatJson').mockImplementation(async (task) => {
      if (task === 'names') {
        return { names: [{ category: 'A', name: 'Only One' }] };
      }
      return [named('Only One')];
    });

    await generate(20);

    // The ceiling is knowable before ten minutes of elaboration, not after.
    const warned = mockCtx.logger.warn.mock.calls
      .map(([message]) => message)
      .join(' ');
    expect(warned).toContain('cannot exceed 1');
  });

  it('falls back to the avoid-list path when naming fails', async () => {
    withNameFirst(true);

    let call = 0;
    vi.spyOn(aiService, '_chatJson').mockImplementation(async (task) => {
      if (task === 'names') {
        throw new Error('provider exploded');
      }
      call++;
      return Array.from({ length: 10 }, (_, i) => named(`Chunk ${call} P${i}`));
    });

    const products = await generate(20);

    // A failed flag costs the flag, not the run.
    expect(products).toHaveLength(20);

    const productVars = mockCtx.prompt.render.mock.calls
      .filter(([template]) => template === 'product')
      .map(([, vars]) => vars);

    expect(productVars[0].assignedNamesGuidance).toBe('');
    expect(productVars[1].avoidProductsGuidance).toContain('Chunk 1 P0');
  });

  it('does not name anything when the flag is off', async () => {
    withNameFirst(false);

    vi.spyOn(aiService, '_chatJson').mockImplementation(async () =>
      Array.from({ length: 10 }, (_, i) => named(`P${i}${Math.random()}`))
    );

    await generate(20);

    expect(
      mockCtx.prompt.render.mock.calls.filter(
        ([template]) => template === 'names'
      )
    ).toHaveLength(0);
  });

  it('records distinct yield against the avoid-list length for each chunk', async () => {
    withNameFirst(false);

    let call = 0;
    vi.spyOn(aiService, '_chatJson').mockImplementation(async () => {
      call++;
      // Chunk 2 repeats chunk 1 wholesale, which is the shape #825 recorded.
      const source = call === 2 ? 1 : call;
      return Array.from({ length: 10 }, (_, i) => named(`C${source} P${i}`));
    });

    await generate(20);

    const yields = mockCtx.logger.info.mock.calls
      .map(([, meta]) => meta)
      .filter((meta) => meta && typeof meta.avoidListSize === 'number');

    expect(yields[0]).toMatchObject({
      avoidListSize: 0,
      kept: 10,
      returned: 10,
    });
    // The measurement that was missing: yield collapsing while the avoid list
    // grows is the signal, and neither number was recorded anywhere.
    expect(yields[1]).toMatchObject({
      avoidListSize: 10,
      kept: 0,
      returned: 10,
    });

    const warned = mockCtx.logger.warn.mock.calls
      .map(([message]) => message)
      .join(' ');
    expect(warned).toContain('unlikely to reach the requested count');
  });
});
