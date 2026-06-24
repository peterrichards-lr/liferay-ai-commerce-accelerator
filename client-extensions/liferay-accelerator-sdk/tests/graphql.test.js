import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './setup.mjs';

const LiferayGraphQLService = require('../src/liferay/graphql.cjs');
const { ENV } = require('../src/utils/constants.cjs');

describe('LiferayGraphQLService', () => {
  let graphqlService;
  let mockCtx;
  let graphqlResponseMock;

  const config = {
    liferayUrl: 'http://localhost:8080',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  };

  beforeEach(() => {
    // Intercept GraphQL post requests dynamically
    graphqlResponseMock = null;
    server.use(
      http.post('*/o/graphql', async ({ request }) => {
        const body = await request.json();
        if (typeof graphqlResponseMock === 'function') {
          return graphqlResponseMock(body);
        }
        return HttpResponse.json({
          data: {},
        });
      })
    );

    mockCtx = {
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
      },
      oauth: {
        getAccessToken: vi.fn().mockResolvedValue('mock-oauth-token'),
      },
    };

    graphqlService = new LiferayGraphQLService(mockCtx);
  });

  afterEach(() => {
    // Reset ENV values to prevent test pollution
    ENV.LIFERAY_API_USERNAME = '';
    ENV.LIFERAY_API_PASSWORD = '';
  });

  describe('Client and Authorization Resolution (_getClient)', () => {
    it('should resolve OAuth authentication header when credentials are provided', async () => {
      const client = await graphqlService._getClient(config);
      expect(client.defaults.headers['Authorization']).toBe(
        'Bearer mock-oauth-token'
      );
      expect(mockCtx.oauth.getAccessToken).toHaveBeenCalledWith(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );
    });

    it('should resolve Basic authentication header when authMethod is basic', async () => {
      const basicConfig = {
        ...config,
        authMethod: 'basic',
        username: 'admin',
        password: 'password123',
      };
      const client = await graphqlService._getClient(basicConfig);
      const expectedToken = Buffer.from('admin:password123').toString('base64');
      expect(client.defaults.headers['Authorization']).toBe(
        `Basic ${expectedToken}`
      );
      expect(mockCtx.oauth.getAccessToken).not.toHaveBeenCalled();
    });

    it('should fallback to ENV Basic Auth credentials if clientId is missing', async () => {
      ENV.LIFERAY_API_USERNAME = 'env-user';
      ENV.LIFERAY_API_PASSWORD = 'env-password';

      const fallbackConfig = {
        liferayUrl: 'http://localhost:8080',
      };

      const client = await graphqlService._getClient(fallbackConfig);
      const expectedToken = Buffer.from('env-user:env-password').toString(
        'base64'
      );
      expect(client.defaults.headers['Authorization']).toBe(
        `Basic ${expectedToken}`
      );
    });
  });

  describe('ERC-based Lookups (fetchEntitiesByERC / _fetchByERCs)', () => {
    it('should return empty list if ercs parameter is empty or undefined', async () => {
      const result = await graphqlService.fetchEntitiesByERC(
        config,
        'namespace',
        'method',
        []
      );
      expect(result).toEqual([]);
    });

    it('should fetch entities using aliased queries and flat map them', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain(
          'alias0: method(externalReferenceCode: "ERC-1")'
        );
        expect(body.query).toContain(
          'alias1: method(externalReferenceCode: "ERC-2")'
        );
        return HttpResponse.json({
          data: {
            namespace: {
              alias0: { id: 1, name: 'Entity 1' },
              alias1: { id: 2, name: 'Entity 2' },
            },
          },
        });
      };

      const result = await graphqlService.fetchEntitiesByERC(
        config,
        'namespace',
        'method',
        ['ERC-1', 'ERC-2'],
        ['id', 'name']
      );

      expect(result).toEqual([
        { id: 1, name: 'Entity 1' },
        { id: 2, name: 'Entity 2' },
      ]);
    });

    it('should chunk requests based on maxBatchSize', async () => {
      // Temporarily decrease maxBatchSize for testing chunking
      graphqlService.maxBatchSize = 2;
      let requestCount = 0;

      graphqlResponseMock = (body) => {
        requestCount++;
        if (requestCount === 1) {
          expect(body.query).toContain('alias0');
          expect(body.query).toContain('alias1');
          expect(body.query).not.toContain('alias2');
          return HttpResponse.json({
            data: {
              namespace: {
                alias0: { id: 1 },
                alias1: { id: 2 },
              },
            },
          });
        } else if (requestCount === 2) {
          expect(body.query).toContain('alias2');
          expect(body.query).not.toContain('alias3');
          return HttpResponse.json({
            data: {
              namespace: {
                alias2: { id: 3 },
              },
            },
          });
        }
      };

      const result = await graphqlService.fetchEntitiesByERC(
        config,
        'namespace',
        'method',
        ['ERC-1', 'ERC-2', 'ERC-3'],
        ['id']
      );

      expect(requestCount).toBe(2);
      expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    it('should log warnings and continue on partial GraphQL errors', async () => {
      graphqlResponseMock = () => {
        return HttpResponse.json({
          data: {
            namespace: {
              alias0: { id: 1 },
            },
          },
          errors: [{ message: 'Some partial GraphQL warning' }],
        });
      };

      const result = await graphqlService.fetchEntitiesByERC(
        config,
        'namespace',
        'method',
        ['ERC-1'],
        ['id']
      );

      expect(result).toEqual([{ id: 1 }]);
      expect(mockCtx.logger.warn).toHaveBeenCalled();
    });

    it('should throw and log warning when GraphQL request fails completely', async () => {
      graphqlResponseMock = () => {
        return new HttpResponse(null, { status: 500 });
      };

      await expect(
        graphqlService.fetchEntitiesByERC(
          config,
          'namespace',
          'method',
          ['ERC-1'],
          ['id']
        )
      ).rejects.toThrow();

      expect(mockCtx.logger.warn).toHaveBeenCalled();
    });
  });

  describe('Unified Collection Fetcher (_fetchCollection)', () => {
    it('should query first page and return items and totalCount', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain('currencies(page: 1, pageSize: 200)');
        return HttpResponse.json({
          data: {
            headlessCommerceAdminCatalog_v1_0: {
              currencies: {
                items: [{ id: 1, code: 'USD' }],
                totalCount: 1,
              },
            },
          },
        });
      };

      const result = await graphqlService.getCurrencies(config);
      expect(result).toEqual({
        items: [{ id: 1, code: 'USD' }],
        totalCount: 1,
      });
    });

    it('should auto-paginate when totalCount is larger than query items size', async () => {
      let pageRequested = 0;
      graphqlResponseMock = (body) => {
        pageRequested++;
        if (pageRequested === 1) {
          expect(body.query).toContain('currencies(page: 1, pageSize: 2)');
          return HttpResponse.json({
            data: {
              headlessCommerceAdminCatalog_v1_0: {
                currencies: {
                  items: [{ id: 1 }, { id: 2 }],
                  totalCount: 3,
                },
              },
            },
          });
        } else {
          expect(body.query).toContain('currencies(page: 2, pageSize: 2)');
          return HttpResponse.json({
            data: {
              headlessCommerceAdminCatalog_v1_0: {
                currencies: {
                  items: [{ id: 3 }],
                  totalCount: 3,
                },
              },
            },
          });
        }
      };

      const result = await graphqlService._fetchCollection(
        config,
        'headlessCommerceAdminCatalog_v1_0',
        'currencies',
        ['id'],
        { page: 1, pageSize: 2 }
      );

      expect(pageRequested).toBe(2);
      expect(result.items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(result.totalCount).toBe(3);
    });

    it('should escape filter and search parameters', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain('filter: "name eq \\"My Test\\""');
        expect(body.query).toContain('search: "pattern \\"abc\\""');
        return HttpResponse.json({
          data: {
            headlessCommerceAdminCatalog_v1_0: {
              currencies: {
                items: [],
                totalCount: 0,
              },
            },
          },
        });
      };

      await graphqlService._fetchCollection(
        config,
        'headlessCommerceAdminCatalog_v1_0',
        'currencies',
        ['id'],
        { page: 1, pageSize: 200 },
        'name eq "My Test"',
        'pattern "abc"'
      );
    });

    it('should throw an error and log warnings if errors property is in response data', async () => {
      graphqlResponseMock = () => {
        return HttpResponse.json({
          data: null,
          errors: [
            { message: 'Collection permission denied', path: ['currencies'] },
          ],
        });
      };

      await expect(graphqlService.getCurrencies(config)).rejects.toThrow(
        'GraphQL Errors in currencies: Collection permission denied'
      );

      expect(mockCtx.logger.warn).toHaveBeenCalled();
    });

    it('should break pagination loop if page limit exceeds 1000', async () => {
      graphqlResponseMock = () => {
        return HttpResponse.json({
          data: {
            headlessCommerceAdminCatalog_v1_0: {
              currencies: {
                items: [{ id: 1 }],
                totalCount: 5000,
              },
            },
          },
        });
      };

      const result = await graphqlService._fetchCollection(
        config,
        'headlessCommerceAdminCatalog_v1_0',
        'currencies',
        ['id'],
        { page: 1, pageSize: 1 }
      );

      // It should terminate instead of looping forever
      expect(result.items.length).toBeLessThan(5000);
    });
  });

  describe('Specific Entity Wrappers', () => {
    it('should fetch taxonomy categories by vocabulary ID', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain(
          'taxonomyVocabularyTaxonomyCategories(taxonomyVocabularyId: 1234, flatten: true, pageSize: 500)'
        );
        return HttpResponse.json({
          data: {
            headlessAdminTaxonomy_v1_0: {
              taxonomyVocabularyTaxonomyCategories: {
                items: [{ id: 1, name: 'Category 1' }],
                totalCount: 1,
              },
            },
          },
        });
      };

      const result = await graphqlService.getTaxonomyCategories(config, 1234);
      expect(result.items).toEqual([{ id: 1, name: 'Category 1' }]);
    });

    it('should throw and log warning when GraphQL returns error for taxonomy categories query', async () => {
      graphqlResponseMock = () => {
        return HttpResponse.json({
          errors: [{ message: 'Access denied' }],
        });
      };

      await expect(
        graphqlService.getTaxonomyCategories(config, 1234)
      ).rejects.toThrow('Access denied');
    });

    it('should fetch taxonomy vocabularies by siteKey', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain('taxonomyVocabularies');
        return HttpResponse.json({
          data: {
            headlessAdminTaxonomy_v1_0: {
              taxonomyVocabularies: {
                items: [{ id: 'vocab-1', name: 'Vocab 1' }],
                totalCount: 1,
              },
            },
          },
        });
      };

      const result = await graphqlService.getTaxonomyVocabularies(
        config,
        'site-1'
      );
      expect(result.items).toEqual([{ id: 'vocab-1', name: 'Vocab 1' }]);
    });

    it('should fetch languages by siteKey', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain('languages(siteKey: "site-1")');
        return HttpResponse.json({
          data: {
            headlessDelivery_v1_0: {
              languages: {
                items: [{ id: 'en-US', name: 'English' }],
                totalCount: 1,
              },
            },
          },
        });
      };

      const result = await graphqlService.getLanguages(config, 'site-1');
      expect(result.items).toEqual([{ id: 'en-US', name: 'English' }]);
    });

    it('should throw and log warning when GraphQL returns error for languages query', async () => {
      graphqlResponseMock = () => {
        return HttpResponse.json({
          errors: [{ message: 'Access denied' }],
        });
      };

      await expect(
        graphqlService.getLanguages(config, 'site-1')
      ).rejects.toThrow('Access denied');
    });

    it('should fetch site languages by siteKey', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain('languages(siteKey: "site-2")');
        return HttpResponse.json({
          data: {
            headlessDelivery_v1_0: {
              languages: {
                items: [{ id: 'es-ES', name: 'Spanish' }],
                totalCount: 1,
              },
            },
          },
        });
      };

      const result = await graphqlService.getSiteLanguages(config, 'site-2');
      expect(result.items).toEqual([{ id: 'es-ES', name: 'Spanish' }]);
    });

    it('should throw and log warning when GraphQL returns error for site languages query', async () => {
      graphqlResponseMock = () => {
        return HttpResponse.json({
          errors: [{ message: 'Access denied' }],
        });
      };

      await expect(
        graphqlService.getSiteLanguages(config, 'site-2')
      ).rejects.toThrow('Access denied');
    });

    it('should fetch country regions by countryId', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain('countryRegions(countryId: 5678)');
        return HttpResponse.json({
          data: {
            headlessAdminAddress_v1_0: {
              countryRegions: {
                items: [{ id: 9, name: 'Region 9' }],
                totalCount: 1,
              },
            },
          },
        });
      };

      const result = await graphqlService.getCountryRegions(config, 5678);
      expect(result.items).toEqual([{ id: 9, name: 'Region 9' }]);
    });

    it('should throw and log warning when GraphQL returns error for country regions query', async () => {
      graphqlResponseMock = () => {
        return HttpResponse.json({
          errors: [{ message: 'Access denied' }],
        });
      };

      await expect(
        graphqlService.getCountryRegions(config, 5678)
      ).rejects.toThrow('Access denied');
    });

    it('should fetch warehouse items', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain(
          'warehouseIdWarehouseItems(id: 1111, page: 1, pageSize: 200)'
        );
        return HttpResponse.json({
          data: {
            headlessCommerceAdminInventory_v1_0: {
              warehouseIdWarehouseItems: {
                items: [{ sku: 'SKU-1', quantity: 100 }],
                totalCount: 1,
              },
            },
          },
        });
      };

      const result = await graphqlService.getWarehouseItems(
        config,
        1111,
        null,
        ['sku', 'quantity']
      );
      expect(result.items).toEqual([{ sku: 'SKU-1', quantity: 100 }]);
    });

    it('should throw and log warning when GraphQL returns error for warehouse items query', async () => {
      graphqlResponseMock = () => {
        return HttpResponse.json({
          errors: [{ message: 'Access denied' }],
        });
      };

      await expect(
        graphqlService.getWarehouseItems(config, 1111, null, ['sku'])
      ).rejects.toThrow('Access denied');
    });

    it('should get options by product IDs', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain('p0: product(id: 101)');
        expect(body.query).toContain('p1: product(id: 102)');
        return HttpResponse.json({
          data: {
            headlessCommerceAdminCatalog_v1_0: {
              p0: {
                productOptions: [{ id: 1, optionId: 'opt-1' }],
              },
              p1: {
                productOptions: [{ id: 2, optionId: 'opt-2' }],
              },
            },
          },
        });
      };

      const result = await graphqlService.getOptionsByProductIds(
        config,
        [101, 102]
      );
      expect(result).toEqual([
        { id: 1, optionId: 'opt-1' },
        { id: 2, optionId: 'opt-2' },
      ]);
    });

    it('should return empty list when getting options with empty product ID array', async () => {
      const result = await graphqlService.getOptionsByProductIds(config, []);
      expect(result).toEqual([]);
    });

    it('should throw and log warning when GraphQL returns error for options query', async () => {
      graphqlResponseMock = () => {
        return HttpResponse.json({
          errors: [{ message: 'Access denied' }],
        });
      };

      await expect(
        graphqlService.getOptionsByProductIds(config, [101])
      ).rejects.toThrow('Access denied');
    });

    it('should get specifications by product IDs', async () => {
      graphqlResponseMock = (body) => {
        expect(body.query).toContain('p0: product(id: 201)');
        return HttpResponse.json({
          data: {
            headlessCommerceAdminCatalog_v1_0: {
              p0: {
                productSpecifications: [{ id: 5, specificationKey: 'spec-5' }],
              },
            },
          },
        });
      };

      const result = await graphqlService.getSpecificationsByProductIds(
        config,
        [201]
      );
      expect(result).toEqual([{ id: 5, specificationKey: 'spec-5' }]);
    });

    it('should return empty list when getting specifications with empty product ID array', async () => {
      const result = await graphqlService.getSpecificationsByProductIds(
        config,
        []
      );
      expect(result).toEqual([]);
    });

    it('should throw and log warning when GraphQL returns error for specifications query', async () => {
      graphqlResponseMock = () => {
        return HttpResponse.json({
          errors: [{ message: 'Access denied' }],
        });
      };

      await expect(
        graphqlService.getSpecificationsByProductIds(config, [201])
      ).rejects.toThrow('Access denied');
    });
  });

  describe('Entity By ERC wrappers', () => {
    it('should call fetchEntitiesByERC for accountsByERC', async () => {
      const spy = vi
        .spyOn(graphqlService, 'fetchEntitiesByERC')
        .mockResolvedValue([{ id: 10 }]);
      const result = await graphqlService.getAccountsByERC(config, ['ERC-A']);
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessAdminUser_v1_0',
        'accountByExternalReferenceCode',
        ['ERC-A'],
        ['id', 'externalReferenceCode', 'name']
      );
      expect(result).toEqual([{ id: 10 }]);
    });

    it('should call fetchEntitiesByERC for productsByERC', async () => {
      const spy = vi
        .spyOn(graphqlService, 'fetchEntitiesByERC')
        .mockResolvedValue([{ id: 20 }]);
      const result = await graphqlService.getProductsByERC(config, ['ERC-P']);
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminCatalog_v1_0',
        'productByExternalReferenceCode',
        ['ERC-P'],
        ['id', 'externalReferenceCode', 'productId']
      );
      expect(result).toEqual([{ id: 20 }]);
    });

    it('should call fetchEntitiesByERC for warehousesByERC', async () => {
      const spy = vi
        .spyOn(graphqlService, 'fetchEntitiesByERC')
        .mockResolvedValue([{ id: 30 }]);
      const result = await graphqlService.getWarehousesByERC(config, ['ERC-W']);
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminInventory_v1_0',
        'warehouseByExternalReferenceCode',
        ['ERC-W'],
        ['id', 'externalReferenceCode', 'name']
      );
      expect(result).toEqual([{ id: 30 }]);
    });

    it('should call fetchEntitiesByERC for skusByERC', async () => {
      const spy = vi
        .spyOn(graphqlService, 'fetchEntitiesByERC')
        .mockResolvedValue([{ id: 40 }]);
      const result = await graphqlService.getSkusByERC(config, ['ERC-S']);
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminCatalog_v1_0',
        'skuByExternalReferenceCode',
        ['ERC-S'],
        ['id', 'externalReferenceCode', 'sku']
      );
      expect(result).toEqual([{ id: 40 }]);
    });

    it('should call fetchEntitiesByERC for postalAddressesByERC', async () => {
      const spy = vi
        .spyOn(graphqlService, 'fetchEntitiesByERC')
        .mockResolvedValue([{ id: 50 }]);
      const result = await graphqlService.getPostalAddressesByERC(config, [
        'ERC-AD',
      ]);
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessAdminAddress_v1_0',
        'postalAddressByExternalReferenceCode',
        ['ERC-AD'],
        ['id', 'externalReferenceCode']
      );
      expect(result).toEqual([{ id: 50 }]);
    });
  });

  describe('Collection Wrappers thin execution', () => {
    it('should call _fetchCollection for catalogs', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getCatalogs(config);
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminCatalog_v1_0',
        'catalogs',
        [
          'id',
          'externalReferenceCode',
          'name',
          'defaultLanguageId',
          'currencyCode',
        ]
      );
    });

    it('should call _fetchCollection for channels', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getChannels(config);
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminChannel_v1_0',
        'channels',
        ['id', 'externalReferenceCode', 'name', 'siteGroupId', 'currencyCode']
      );
    });

    it('should call _fetchCollection for countries', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getCountries(config);
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessAdminAddress_v1_0',
        'countries',
        ['id', 'a2', 'a3', 'name', 'active', 'title_i18n']
      );
    });

    it('should call _fetchCollection for warehouses', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getWarehouses(
        config,
        'filter',
        ['id'],
        { page: 1 },
        'search'
      );
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminInventory_v1_0',
        'warehouses',
        ['id'],
        { page: 1 },
        'filter',
        'search'
      );
    });

    it('should call _fetchCollection for products ensuring id and ERC', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getProducts(
        config,
        'filter',
        ['name'],
        { page: 1 },
        'search'
      );
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminCatalog_v1_0',
        'products',
        ['name', 'id', 'externalReferenceCode'],
        { page: 1 },
        'filter',
        'search'
      );
    });

    it('should call _fetchCollection for accounts', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getAccounts(
        config,
        'filter',
        ['name'],
        { page: 1 },
        'search'
      );
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessAdminUser_v1_0',
        'accounts',
        ['name'],
        { page: 1 },
        'filter',
        'search'
      );
    });

    it('should call _fetchCollection for orders', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getOrders(
        config,
        'filter',
        ['id'],
        { page: 1 },
        'search'
      );
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminOrder_v1_0',
        'orders',
        ['id'],
        { page: 1 },
        'filter',
        'search'
      );
    });

    it('should call _fetchCollection for options', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getOptions(config, 'filter', ['id'], { page: 1 });
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminCatalog_v1_0',
        'options',
        ['id'],
        { page: 1 },
        'filter'
      );
    });

    it('should call _fetchCollection for optionCategories', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getOptionCategories(config, 'filter', ['id'], {
        page: 1,
      });
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminCatalog_v1_0',
        'optionCategories',
        ['id'],
        { page: 1 },
        'filter'
      );
    });

    it('should call _fetchCollection for specifications', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getSpecifications(config, 'filter', ['id'], {
        page: 1,
      });
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminCatalog_v1_0',
        'specifications',
        ['id'],
        { page: 1 },
        'filter'
      );
    });

    it('should call _fetchCollection for priceLists', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getPriceLists(config, 'filter', ['id'], { page: 1 });
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminPricing_v2_0',
        'priceLists',
        ['id'],
        { page: 1 },
        'filter'
      );
    });

    it('should call _fetchCollection for discounts', async () => {
      const spy = vi
        .spyOn(graphqlService, '_fetchCollection')
        .mockResolvedValue({ items: [] });
      await graphqlService.getDiscounts(config, 'filter', ['id'], { page: 1 });
      expect(spy).toHaveBeenCalledWith(
        config,
        'headlessCommerceAdminPricing_v2_0',
        'discounts',
        ['id'],
        { page: 1 },
        'filter'
      );
    });
  });
});
