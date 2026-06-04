import { vi, describe, it, expect, beforeEach } from 'vitest';

const { LiferayService } = require('../src/liferay/index.cjs');

describe('LiferayService', () => {
  let liferayService;
  let mockCtx;
  const config = {
    liferayUrl: 'http://liferay:8080',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  };

  beforeEach(() => {
    const mockCache = new Map();
    mockCtx = {
      cache: {
        get: (key) => mockCache.get(key),
        set: (key, value) => mockCache.set(key, value),
        clear: () => mockCache.clear(),
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
      },
      config: {},
    };

    // Create a mock OAuthService instance manually
    mockCtx.oauth = {
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
      clearTokenCache: vi.fn(),
      applyConfig: vi.fn(),
    };

    liferayService = new LiferayService(mockCtx);

    // Mock getExclusions to avoid needing real persistence logic in discovery tests
    liferayService._getExclusions = vi.fn().mockResolvedValue([]);
  });

  it('should fetch products using the mocked Liferay API', async () => {
    const result = await liferayService.getProducts(config, { catalogId: 123 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Test Product 1');
    expect(result.items[0].catalogId).toBe(123);
    expect(result.totalCount).toBe(1);
  });

  it('should fetch accounts using the mocked Liferay API', async () => {
    const result = await liferayService.getAccounts(config);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Test Account 1');
    expect(result.items[0].externalReferenceCode).toBe('ACC-1');
    expect(result.totalCount).toBe(1);
  });

  it('should fetch orders using the mocked Liferay API', async () => {
    const result = await liferayService.getOrders(config);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].externalReferenceCode).toBe('ORD-1');
    expect(result.totalCount).toBe(1);
  });

  it('should fetch price lists using the mocked Liferay API', async () => {
    const result = await liferayService.getPriceLists(config);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Test Price List 1');
    expect(result.totalCount).toBe(1);
  });

  it('should fetch warehouses using the mocked Liferay API', async () => {
    const result = await liferayService.getWarehouses(config);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe('Test Warehouse 1');
    expect(result.totalCount).toBe(1);
  });

  it('should fetch batch status using the mocked Liferay API', async () => {
    const result = await liferayService.getImportTask(config, 9001);

    expect(result.executeStatus).toBe('COMPLETED');
    expect(result.processedItemsCount).toBe(10);
    expect(result.totalItemsCount).toBe(10);
    expect(result.id).toBe(9001);
  });

  it('should fail to create products batch if contract is violated', async () => {
    const invalidProducts = [
      {
        name: 'Invalid product',
        productType: 'unknown-type', // Violates enum
      },
    ];

    // Note: We need a real ContractValidator instance for this test
    const ContractValidator = require('../src/services/contractValidator.cjs');
    mockCtx.contractValidator = new ContractValidator(mockCtx);

    await expect(
      liferayService.createProductsBatch(config, invalidProducts)
    ).rejects.toThrow();
  });

  it('should flatten localized names for catalogs', async () => {
    const result = await liferayService.getCatalogs(config);
    expect(result[0].name).toBe('Test Catalog 1');
  });

  it('should flatten localized names for channels', async () => {
    const result = await liferayService.getChannels(config);
    expect(result[0].name).toBe('Test Channel 1');
  });

  it('should flatten localized names for currencies', async () => {
    const result = await liferayService.getCurrencies(config);
    expect(result[0].name).toBe('US Dollar');
  });

  describe('Page Management (LPD-35443) APIs', () => {
    const siteKey = 'test-site-key';

    it('should get site pages', async () => {
      const res = await liferayService.getSitePages(config, siteKey);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].name).toBe('Test Page 1');
      expect(res.items[0].externalReferenceCode).toBe('PAGE-1');
    });

    it('should create site page', async () => {
      const pageData = { externalReferenceCode: 'NEW-PAGE', name: 'New Page' };
      const res = await liferayService.createSitePage(
        config,
        siteKey,
        pageData
      );
      expect(res.name).toBe('New Page');
      expect(res.externalReferenceCode).toBe('NEW-PAGE');
    });

    it('should get specific site page', async () => {
      const res = await liferayService.getSitePage(
        config,
        siteKey,
        'MY-PAGE-1'
      );
      expect(res.externalReferenceCode).toBe('MY-PAGE-1');
      expect(res.name).toBe('Test Page 1');
    });

    it('should update site page', async () => {
      const pageData = { name: 'Updated Page' };
      const res = await liferayService.updateSitePage(
        config,
        siteKey,
        'MY-PAGE-1',
        pageData
      );
      expect(res.name).toBe('Updated Page');
      expect(res.externalReferenceCode).toBe('MY-PAGE-1');
    });

    it('should delete site page', async () => {
      const res = await liferayService.deleteSitePage(
        config,
        siteKey,
        'MY-PAGE-1',
        { fullResponse: true }
      );
      expect(res.status).toBe(204);
    });

    it('should patch site page', async () => {
      const pageData = { name: 'Patched Page' };
      const res = await liferayService.patchSitePage(
        config,
        siteKey,
        'MY-PAGE-1',
        pageData
      );
      expect(res.name).toBe('Patched Page');
      expect(res.externalReferenceCode).toBe('MY-PAGE-1');
    });
  });

  describe('Page Template Management APIs', () => {
    const siteKey = 'test-site-key';

    it('should get page templates', async () => {
      const res = await liferayService.getPageTemplates(config, siteKey);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].name).toBe('Test Template 1');
    });

    it('should create page template', async () => {
      const templateData = {
        externalReferenceCode: 'NEW-TEMP',
        name: 'New Temp',
      };
      const res = await liferayService.createPageTemplate(
        config,
        siteKey,
        templateData
      );
      expect(res.name).toBe('New Temp');
      expect(res.externalReferenceCode).toBe('NEW-TEMP');
    });

    it('should get specific page template', async () => {
      const res = await liferayService.getPageTemplate(
        config,
        siteKey,
        'MY-TEMP-1'
      );
      expect(res.externalReferenceCode).toBe('MY-TEMP-1');
    });

    it('should update page template', async () => {
      const templateData = { name: 'Updated Temp' };
      const res = await liferayService.updatePageTemplate(
        config,
        siteKey,
        'MY-TEMP-1',
        templateData
      );
      expect(res.name).toBe('Updated Temp');
      expect(res.externalReferenceCode).toBe('MY-TEMP-1');
    });

    it('should delete page template', async () => {
      const res = await liferayService.deletePageTemplate(
        config,
        siteKey,
        'MY-TEMP-1',
        { fullResponse: true }
      );
      expect(res.status).toBe(204);
    });

    it('should patch page template', async () => {
      const templateData = { name: 'Patched Temp' };
      const res = await liferayService.patchPageTemplate(
        config,
        siteKey,
        'MY-TEMP-1',
        templateData
      );
      expect(res.name).toBe('Patched Temp');
      expect(res.externalReferenceCode).toBe('MY-TEMP-1');
    });
  });

  describe('Page Template Set Management APIs', () => {
    const siteKey = 'test-site-key';

    it('should get page template sets', async () => {
      const res = await liferayService.getPageTemplateSets(config, siteKey);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].name).toBe('Test Set 1');
    });

    it('should create page template set', async () => {
      const setData = { externalReferenceCode: 'NEW-SET', name: 'New Set' };
      const res = await liferayService.createPageTemplateSet(
        config,
        siteKey,
        setData
      );
      expect(res.name).toBe('New Set');
      expect(res.externalReferenceCode).toBe('NEW-SET');
    });

    it('should get specific page template set', async () => {
      const res = await liferayService.getPageTemplateSet(
        config,
        siteKey,
        'MY-SET-1'
      );
      expect(res.externalReferenceCode).toBe('MY-SET-1');
    });

    it('should update page template set', async () => {
      const setData = { name: 'Updated Set' };
      const res = await liferayService.updatePageTemplateSet(
        config,
        siteKey,
        'MY-SET-1',
        setData
      );
      expect(res.name).toBe('Updated Set');
      expect(res.externalReferenceCode).toBe('MY-SET-1');
    });

    it('should delete page template set', async () => {
      const res = await liferayService.deletePageTemplateSet(
        config,
        siteKey,
        'MY-SET-1',
        { fullResponse: true }
      );
      expect(res.status).toBe(204);
    });

    it('should patch page template set', async () => {
      const setData = { name: 'Patched Set' };
      const res = await liferayService.patchPageTemplateSet(
        config,
        siteKey,
        'MY-SET-1',
        setData
      );
      expect(res.name).toBe('Patched Set');
      expect(res.externalReferenceCode).toBe('MY-SET-1');
    });
  });
});
