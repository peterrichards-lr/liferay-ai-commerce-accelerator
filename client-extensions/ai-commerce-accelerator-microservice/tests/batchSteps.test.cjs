const batchSteps = require('../services/batch/batch-steps/index.cjs');

describe('Commerce Batch Steps', () => {
  let mockLiferay;
  let mockCtx;
  let mockParams;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLiferay = {
      getCatalogs: vi.fn().mockResolvedValue({ items: [{ id: 'cat-123' }] }),
      getPriceLists: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'pl-1',
            type: 'price-list',
            externalReferenceCode: 'AICA-PL1',
            catalogBasePriceList: true,
            name: 'AICA Base PL',
          },
          {
            id: 'pl-2',
            type: 'price-list',
            externalReferenceCode: 'MASTER-PL',
            name: 'Master PL',
          },
        ],
      }),
      patchPriceList: vi.fn().mockResolvedValue({}),
      patchCatalog: vi.fn().mockResolvedValue({}),
      deleteOrdersBatch: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
      deleteWarehousesBatch: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
      deleteWarehouseItemsBatch: vi
        .fn()
        .mockResolvedValue({ status: 'SUCCESS' }),
      deleteAccountsBatch: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
      deleteAccountGroupsBatch: vi
        .fn()
        .mockResolvedValue({ status: 'SUCCESS' }),
      deleteProductsBatch: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
      getProductOptions: vi.fn().mockResolvedValue([{ id: 'po-1' }]),
      deleteProductOption: vi.fn().mockResolvedValue({}),
      getProductSpecifications: vi.fn().mockResolvedValue([{ id: 'ps-1' }]),
      deleteProductSpecification: vi.fn().mockResolvedValue({}),
      deletePriceListsBatch: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
      deletePromotionsBatch: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
      deleteSpecificationsBatch: vi
        .fn()
        .mockResolvedValue({ status: 'SUCCESS' }),
      deleteOptionsBatch: vi.fn().mockResolvedValue({ status: 'SUCCESS' }),
      deleteOptionCategoriesBatch: vi
        .fn()
        .mockResolvedValue({ status: 'SUCCESS' }),
      deleteProductRelatedEntitiesBatch: vi
        .fn()
        .mockResolvedValue({ status: 'SUCCESS' }),
      createAccountsBatch: vi.fn().mockResolvedValue({ batchRefs: ['ref-1'] }),
      createAccountAddressBatch: vi
        .fn()
        .mockResolvedValue({ batchRefs: ['ref-2'] }),
      getSpecificationsByProductIds: vi
        .fn()
        .mockResolvedValue([
          { specificationId: 'spec-1', optionCategoryId: 'cat-1' },
        ]),
      getOptionsByProductIds: vi
        .fn()
        .mockResolvedValue([{ optionId: 'opt-1' }]),
      getAccountByERC: vi
        .fn()
        .mockResolvedValue({ id: 'acc-123', externalReferenceCode: 'ERC1' }),
    };

    mockCtx = {
      liferay: mockLiferay,
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
      },
      persistence: {
        updateBatch: vi.fn(),
      },
    };

    mockParams = {
      config: { batchSize: 2, liferayUrl: 'http://localhost:8080' },
      options: { dryRun: false },
      session: { id: 'sess-1' },
      ids: [1, 2],
      items: [{ id: 1 }, { id: 2 }],
      productIds: [101, 102],
      productId: 101,
      channelId: 'channel-1',
      batchERC: 'batch-erc-1',
      sessionId: 'session-1',
      accounts: [
        {
          externalReferenceCode: 'ERC1',
          name: 'Acc1',
          billingAddress: {},
          shippingAddress: {},
          headOfficeAddress: {},
        },
        {
          externalReferenceCode: 'ERC2',
          name: 'Acc2',
          billingAddress: {},
          shippingAddress: {},
        },
      ],
      lastBatchResults: [
        { id: 'acc-1', externalReferenceCode: 'ERC1' },
        { id: 'acc-2', externalReferenceCode: 'ERC2' },
      ],
      addresses: [
        { street: 'Street1', accountId: 1 },
        { street: 'Street2', accountId: 2 },
      ],
      entityTypeToResolve: 'accounts',
    };
  });

  describe('Deletion steps', () => {
    it('should call resetCatalogConfiguration', async () => {
      const res = await batchSteps.resetCatalogConfiguration(
        mockCtx,
        mockParams
      );
      expect(mockLiferay.getCatalogs).toHaveBeenCalled();
      expect(mockLiferay.getPriceLists).toHaveBeenCalled();
      expect(mockLiferay.patchPriceList).toHaveBeenCalled();
      expect(res.success).toBe(true);
    });

    it('should call deleteOrdersBatch', async () => {
      const res = await batchSteps.deleteOrders(mockCtx, mockParams);
      expect(mockLiferay.deleteOrdersBatch).toHaveBeenCalledWith(
        mockParams.config,
        expect.objectContaining({
          ids: mockParams.ids,
          filter: 'channelId eq channel-1',
        })
      );
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deleteWarehousesBatch', async () => {
      const res = await batchSteps.deleteWarehouses(mockCtx, mockParams);
      expect(mockLiferay.deleteWarehousesBatch).toHaveBeenCalled();
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deleteWarehouseItemsBatch', async () => {
      const res = await batchSteps.deleteWarehouseItems(mockCtx, mockParams);
      expect(mockLiferay.deleteWarehouseItemsBatch).toHaveBeenCalled();
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deleteAccountsBatch', async () => {
      const res = await batchSteps.deleteAccounts(mockCtx, mockParams);
      expect(mockLiferay.deleteAccountsBatch).toHaveBeenCalled();
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deleteAccountGroupsBatch', async () => {
      const res = await batchSteps.deleteAccountGroups(mockCtx, mockParams);
      expect(mockLiferay.deleteAccountGroupsBatch).toHaveBeenCalled();
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deleteProductsBatch', async () => {
      const res = await batchSteps.deleteProducts(mockCtx, mockParams);
      expect(mockLiferay.deleteProductsBatch).toHaveBeenCalled();
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deleteProductOptions associations', async () => {
      const res = await batchSteps.deleteProductOptions(mockCtx, mockParams);
      expect(mockLiferay.getProductOptions).toHaveBeenCalledWith(
        mockParams.config,
        1
      );
      expect(mockLiferay.deleteProductOption).toHaveBeenCalledWith(
        mockParams.config,
        1,
        'po-1'
      );
      expect(mockCtx.persistence.updateBatch).toHaveBeenCalled();
      expect(res.success).toBe(true);
    });

    it('should call deleteProductSpecifications associations', async () => {
      const res = await batchSteps.deleteProductSpecifications(
        mockCtx,
        mockParams
      );
      expect(mockLiferay.getProductSpecifications).toHaveBeenCalledWith(
        mockParams.config,
        1
      );
      expect(mockLiferay.deleteProductSpecification).toHaveBeenCalledWith(
        mockParams.config,
        1,
        'ps-1'
      );
      expect(mockCtx.persistence.updateBatch).toHaveBeenCalled();
      expect(res.success).toBe(true);
    });

    it('should call deletePriceListsBatch', async () => {
      const res = await batchSteps.deletePriceLists(mockCtx, mockParams);
      expect(mockLiferay.deletePriceListsBatch).toHaveBeenCalled();
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deletePromotionsBatch', async () => {
      const res = await batchSteps.deletePromotions(mockCtx, mockParams);
      expect(mockLiferay.deletePromotionsBatch).toHaveBeenCalled();
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deleteSpecificationsBatch', async () => {
      const res = await batchSteps.deleteSpecifications(mockCtx, mockParams);
      expect(mockLiferay.deleteSpecificationsBatch).toHaveBeenCalled();
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deleteOptionsBatch', async () => {
      const res = await batchSteps.deleteOptions(mockCtx, mockParams);
      expect(mockLiferay.deleteOptionsBatch).toHaveBeenCalled();
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deleteOptionCategoriesBatch', async () => {
      const res = await batchSteps.deleteOptionCategories(mockCtx, mockParams);
      expect(mockLiferay.deleteOptionCategoriesBatch).toHaveBeenCalled();
      expect(res.status).toBe('SUCCESS');
    });

    it('should call deleteProductRelatedEntities and query and delete global entities', async () => {
      const res = await batchSteps.deleteProductRelatedEntities(
        mockCtx,
        mockParams
      );
      expect(mockLiferay.getSpecificationsByProductIds).toHaveBeenCalledWith(
        mockParams.config,
        mockParams.productIds
      );
      expect(mockLiferay.getOptionsByProductIds).toHaveBeenCalledWith(
        mockParams.config,
        mockParams.productIds
      );
      expect(mockLiferay.deleteSpecificationsBatch).toHaveBeenCalledWith(
        mockParams.config,
        expect.objectContaining({ ids: ['spec-1'] })
      );
      expect(mockLiferay.deleteOptionsBatch).toHaveBeenCalledWith(
        mockParams.config,
        expect.objectContaining({ ids: ['opt-1'] })
      );
      expect(mockLiferay.deleteOptionCategoriesBatch).toHaveBeenCalledWith(
        mockParams.config,
        expect.objectContaining({ ids: ['cat-1'] })
      );
      expect(res).toBeNull();
    });
  });

  describe('Generation/Helper steps', () => {
    it('should strip address objects and batch create accounts', async () => {
      const res = await batchSteps.createAccounts(mockCtx, mockParams);
      expect(mockLiferay.createAccountsBatch).toHaveBeenCalledTimes(1);
      expect(res.batchRefs).toEqual(['ref-1']);
    });

    it('should batch create postal addresses', async () => {
      const res = await batchSteps.createPostalAddresses(mockCtx, mockParams);
      expect(mockLiferay.createAccountAddressBatch).toHaveBeenCalledTimes(2);
      expect(res.batchRefs).toEqual(['ref-2', 'ref-2']);
    });

    it('should log next step using logNextStep', async () => {
      const res = await batchSteps.logNextStep(mockCtx, {
        batchERC: 'batch-erc-1',
      });
      expect(mockCtx.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('SUCCESS: The logNextStep was called.'),
        expect.any(Object)
      );
    });

    it('should resolve accounts entities in resolveEntities', async () => {
      const res = await batchSteps.resolveEntities(mockCtx, mockParams);
      expect(mockLiferay.getAccountByERC).toHaveBeenCalledWith(
        mockParams.config,
        'ERC1'
      );
      expect(res).toEqual([
        { id: 'acc-123', externalReferenceCode: 'ERC1' },
        { id: 'acc-123', externalReferenceCode: 'ERC1' },
      ]);
    });

    it('should handle resolveEntities with no source accounts to process', async () => {
      mockParams.accounts = null;
      const res = await batchSteps.resolveEntities(mockCtx, mockParams);
      expect(mockCtx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'resolveEntities called with no source accounts'
        ),
        expect.any(Object)
      );
      expect(res).toEqual({ enrichedResults: [] });
    });

    it('should warn and bypass when entityTypeToResolve is unmapped', async () => {
      mockParams.entityTypeToResolve = 'unmapped';
      const res = await batchSteps.resolveEntities(mockCtx, mockParams);
      expect(mockCtx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "No ERC lookup method configured for entity type: 'unmapped'"
        ),
        expect.any(Object)
      );
      expect(res).toEqual({ enrichedResults: mockParams.accounts });
    });
  });
});
