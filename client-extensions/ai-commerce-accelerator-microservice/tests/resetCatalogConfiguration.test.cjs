const resetCatalogConfiguration = require('../services/batch/batch-steps/resetCatalogConfiguration.cjs');

/**
 * The catalog base flag cannot be written through Headless, and this step used
 * to report that it had.
 *
 * `PATCH /price-lists/{id}` answers 200 and discards `catalogBasePriceList` on
 * 2026.q3.0 (#943). Three writes in this step read that 200 as success - the
 * AICA unset loop and the two master restores - so a delete run logged a
 * restore it never performed, and a comment promised the unset "guarantees"
 * deletion would work.
 *
 * The step cannot make the write land. What it can do is read the value back
 * and say so, which is what these pin (#790).
 */
describe('restoring the catalog base flag (#790, #943)', () => {
  let mockLiferay;
  let mockLogger;

  const MASTER = {
    catalogBasePriceList: false,
    externalReferenceCode: 'MASTER-PL',
    id: 'pl-master',
    name: 'Master Base Price List',
    type: 'price-list',
  };

  const AICA = {
    catalogBasePriceList: true,
    externalReferenceCode: 'AICA-PL1',
    id: 'pl-aica',
    name: 'AICA - Generated',
    type: 'price-list',
  };

  // Liferay's real behaviour: the request is accepted and the field is not
  // changed. `items` is therefore whatever it was before the patch.
  const acceptsAndIgnores = (items) => ({
    getPriceLists: vi.fn().mockResolvedValue({ items }),
    patchCatalog: vi.fn().mockResolvedValue({}),
    patchPriceList: vi.fn().mockResolvedValue({}),
  });

  const run = (liferay) =>
    resetCatalogConfiguration(
      { liferay, logger: mockLogger },
      { config: { catalogId: 34586 }, session: {}, sessionId: 'sess-1' }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
  });

  it('says so when Liferay accepts the write and changes nothing', async () => {
    mockLiferay = acceptsAndIgnores([MASTER, AICA]);

    await run(mockLiferay);

    const warnings = mockLogger.warn.mock.calls.map(([m]) => m).join('\n');

    expect(warnings).toContain('accepted the request and did not change it');
    expect(warnings).toContain('#943');
    // The operator's actual position, stated rather than implied.
    expect(warnings).toContain('base list is whatever it was before this run');
  });

  it('names which list refused, not just that something failed', async () => {
    mockLiferay = acceptsAndIgnores([MASTER, AICA]);

    await run(mockLiferay);

    const warnings = mockLogger.warn.mock.calls.map(([m]) => m).join('\n');

    expect(warnings).toContain('master Price List');
    expect(warnings).toContain(String(MASTER.id));
  });

  it('never calls patchCatalog, which cannot succeed on this DXP line', async () => {
    // `catalogBasePriceListId` and `catalogBasePromotionId` both answer
    // 400 "not defined in Catalog". The call was labelled HARDENING and had
    // been failing on every delete run; it produced the second of the two
    // unusable warnings #790 was opened for.
    mockLiferay = acceptsAndIgnores([MASTER, AICA]);

    await run(mockLiferay);

    expect(mockLiferay.patchCatalog).not.toHaveBeenCalled();
  });

  it('stays quiet when the write does take', async () => {
    // Guards the other direction: if #943 is fixed upstream, or another DXP
    // line honours the field, this step must stop warning rather than warn
    // forever.
    const items = [{ ...MASTER }, { ...AICA }];
    mockLiferay = {
      getPriceLists: vi.fn().mockImplementation(async () => ({ items })),
      patchCatalog: vi.fn().mockResolvedValue({}),
      patchPriceList: vi.fn().mockImplementation(async (_c, id, data) => {
        const target = items.find((pl) => String(pl.id) === String(id));
        if (target) {
          target.catalogBasePriceList = data.catalogBasePriceList;
        }
        return {};
      }),
    };

    await run(mockLiferay);

    const warnings = mockLogger.warn.mock.calls.map(([m]) => m).join('\n');

    expect(warnings).not.toContain(
      'accepted the request and did not change it'
    );
  });

  it('reports an unreadable list rather than assuming the write landed', async () => {
    mockLiferay = {
      getPriceLists: vi
        .fn()
        .mockResolvedValueOnce({ items: [MASTER, AICA] })
        .mockResolvedValue({ items: [] }),
      patchCatalog: vi.fn().mockResolvedValue({}),
      patchPriceList: vi.fn().mockResolvedValue({}),
    };

    await run(mockLiferay);

    const warnings = mockLogger.warn.mock.calls.map(([m]) => m).join('\n');

    expect(warnings).toContain('whether it took is unknown');
  });

  it('carries on to the next catalog when one refuses', async () => {
    // A delete run covering several catalogs should not lose the rest because
    // one could not be restored.
    mockLiferay = acceptsAndIgnores([MASTER, AICA]);

    const result = await resetCatalogConfiguration(
      { liferay: mockLiferay, logger: mockLogger },
      { config: {}, session: {}, sessionId: 'sess-1' }
    );

    expect(result).toEqual({ success: true });
  });
});
