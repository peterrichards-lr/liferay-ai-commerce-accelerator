const { getBatchCacheTTLms } = require('../utils/ttl.cjs');

class DeleteCoordinatorService {
  constructor(ctx) {
    this.ctx = ctx;
  }

  _extractIdFromLocation(location) {
    if (!location) return null;
    const s = String(location);

    const m =
      s.match(/\/batch-engine\/(?:import-task|export-task|task)\/(\d+)\b/) ||
      s.match(/\/(?:import-task|export-task|task)\/(\d+)\b/);

    return m ? m[1] : null;
  }

  _normalizeBatchId(ref) {
    if (ref == null) return null;
    if (typeof ref === 'string' || typeof ref === 'number') return String(ref);
    return (
      ref?.taskId ||
      ref?.id ||
      this._extractIdFromLocation(ref?.location) ||
      ref?.batchId ||
      null
    );
  }

  _deriveTotalFromResult(result) {
    if (!result) return 0;
    const candidates = [
      result.totalCount,
      result.count,
      result.total,
      Array.isArray(result.items) ? result.items.length : undefined,
      Array.isArray(result.ids) ? result.ids.length : undefined,
      Array.isArray(result.targets) ? result.targets.length : undefined,
      Array.isArray(result.toDelete) ? result.toDelete.length : undefined,
      Array.isArray(result.entities) ? result.entities.length : undefined,
    ].filter((v) => Number.isFinite(v) && v >= 0);

    if (candidates.length > 0) return candidates[0];
    if (result.summary && Number.isFinite(result.summary.total)) {
      return result.summary.total;
    }
    return 0;
  }

  recordBatches(batchRefs, config, entityType, totalCount) {
    const { logger, cache, configService } = this.ctx;
    const refs = Array.isArray(batchRefs)
      ? batchRefs
      : batchRefs
      ? [batchRefs]
      : [];
    if (refs.length === 0) return;
    for (const ref of refs) {
      const batchId = this._normalizeBatchId(ref);
      if (!batchId) {
        logger.warn('Unable to determine batchId from reference', {
          operation: 'batch-config-store-missing-id',
          entityType,
          ref,
        });
        continue;
      }

      cache.set(
        `batch:${batchId}:config`,
        {
          affectsProgress: true,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          correlationId: config.correlationId || null,
          createdAt: new Date().toISOString(),
          entityType,
          liferayUrl: config.liferayUrl,
          localeCode: config.localeCode,
          operation: 'delete',
          totalCount: Number.isFinite(totalCount) ? totalCount : 0,
          pollInterval: config.pollInterval || 5000,
          maxPollAttempts: config.maxPollAttempts || 120,
          mode: 'delete',
        },
        getBatchCacheTTLms(configService)
      );

      logger.info('Batch config stored', {
        operation: 'batch-config-store',
        batchId,
        entityType,
        totalCount: Number.isFinite(totalCount) ? totalCount : 0,
      });
    }
  }

  async _waitForBatches(refs, config, entityType) {
    const { logger, batchPolling } = this.ctx;
    const batchIds = (Array.isArray(refs) ? refs : refs ? [refs] : [])
      .map((r) => this._normalizeBatchId(r))
      .filter(Boolean);
    if (batchIds.length === 0) return;

    const pollInterval = Number(config.pollInterval) || 5000;
    const maxPollAttempts = Number(config.maxPollAttempts) || 120;

    for (const bid of batchIds) {
      await new Promise((resolve) => {
        const started = Date.now();
        batchPolling.startPolling(
          String(bid),
          {
            liferayUrl: config.liferayUrl,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            localeCode: config.localeCode,
            entityType,
          },
          {
            pollInterval,
            maxPollAttempts,
            timeoutMs: maxPollAttempts * pollInterval * 1.5,
            onTimeout: () => {
              logger.warn(`Delete ${entityType} batch timed out`, {
                batchId: String(bid),
              });
              resolve();
            },
            onStatusChange: () => {},
            onComplete: (r) => {
              const elapsedMs = Date.now() - started;
              logger.info(`Delete ${entityType} batch complete`, {
                batchId: String(bid),
                status: r.status,
                processedCount: r.processedCount,
                totalCount: r.totalCount,
                elapsedMs,
              });
              resolve();
            },
            onError: (e) => {
              logger.error(`Delete ${entityType} batch polling error`, {
                batchId: String(bid),
                error: e.message,
              });
              resolve();
            },
            entityType,
            operation: 'delete',
            mode: 'batch',
            affectsProgress: true,
          }
        );
      });
    }
  }

  _expectedOptionCategoryKeys(options) {
    const categories = options?.productCategories || [];
    const categoryGroupsMap = options?.categoryGroupsMap || null;
    const result = new Set();
    const fallbackGroups = {
      Electronics: ['performance','connectivity','physical','support'],
      Clothing: ['material-care','fit-style','details','origin'],
      'Home & Garden': ['dimensions-weight','material-build','features','care-warranty']
    };
    for (const category of categories) {
      const groups = (categoryGroupsMap && categoryGroupsMap[category])
        ? categoryGroupsMap[category].map(g => g.key)
        : (fallbackGroups[category] || fallbackGroups['Electronics']);
      for (const g of groups) result.add(`${String(category).toLowerCase()}-${g}`);
    }
    return Array.from(result);
  }

  async _listOptionCategories(config, { search, pageSize = 200 } = {}) {
    const { logger, liferay } = this.ctx;
    try {
      if (liferay.getOptionCategories) {
        return await liferay.getOptionCategories(config, { search, pageSize, fields: 'id,key' });
      }
    } catch (e) {
      logger.debug('getOptionCategories via client failed; falling back to HTTP', { error: e.message });
    }
    if (!liferay.httpGet) {
      logger.debug('No httpGet on liferay client; cannot list option categories');
      return { items: [] };
    }
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    params.set('page', '1');
    params.set('pageSize', String(pageSize));
    params.set('fields', 'id,key');
    const url = `/o/headless-commerce-admin-catalog/v1.0/optionCategories?${params.toString()}`;
    const res = await liferay.httpGet(config, url);
    return res || { items: [] };
  }

  async _deleteOptionCategoriesDirect(config, options) {
    const { logger, liferay } = this.ctx;
    if (!liferay.getOptionCategoryByKey || !liferay.deleteOptionCategoryById) {
      logger.debug('Direct delete for option categories not supported by liferay client; skipping fallback');
      return { deleted: 0 };
    }
    const keys = this._expectedOptionCategoryKeys(options);
    let deleted = 0;
    for (const key of keys) {
      try {
        const cat = await liferay.getOptionCategoryByKey(config, key);
        if (cat && cat.id) {
          await liferay.deleteOptionCategoryById(config, cat.id);
          deleted++;
          logger.info('Deleted option category by key (direct)', { key, id: cat.id });
        }
      } catch (e) {
        // Not found or delete failed; continue to next
        logger.debug('Direct delete option category skipped', { key, error: e.message });
      }
    }
    return { deleted };
  }

  async _deleteOptionCategoriesBySearch(config, options) {
    const { logger, liferay } = this.ctx;
    const prefixes = new Set();
    for (const cat of options?.productCategories || []) {
      prefixes.add(`${String(cat).toLowerCase()}-`);
    }
    let totalDeleted = 0;
    for (const prefix of prefixes) {
      try {
        const res = await this._listOptionCategories(config, { search: prefix });
        const items = Array.isArray(res?.items) ? res.items : [];
        for (const oc of items) {
          try {
            if (!oc?.id) continue;
            if (typeof liferay.deleteOptionCategoryById === 'function') {
              await liferay.deleteOptionCategoryById(config, oc.id);
            } else if (typeof liferay.httpDelete === 'function') {
              await liferay.httpDelete(config, `/o/headless-commerce-admin-catalog/v1.0/optionCategories/${oc.id}`);
            } else {
              logger.debug('No delete method available for option categories');
              break;
            }
            totalDeleted++;
            logger.info('Deleted option category (search fallback)', { id: oc.id, key: oc.key });
          } catch (e) {
            logger.debug('Failed to delete option category (search fallback)', { id: oc.id, error: e.message });
          }
        }
      } catch (e) {
        logger.debug('Option category search failed', { prefix, error: e.message });
      }
    }
    return { deleted: totalDeleted };
  }

  async _deleteSpecificationsBySearch(config, options) {
    const { logger, liferay } = this.ctx;
    const prefixes = new Set();
    for (const cat of options?.productCategories || []) prefixes.add(`${String(cat).toLowerCase()}-`);
    let totalDeleted = 0;
    for (const prefix of prefixes) {
      try {
        let res;
        if (typeof liferay.getSpecifications === 'function') {
          res = await liferay.getSpecifications(config, { search: prefix, pageSize: 200, fields: 'id,key' });
        } else if (typeof liferay.httpGet === 'function') {
          const params = new URLSearchParams({ search: prefix, page: '1', pageSize: '200', fields: 'id,key' });
          res = await liferay.httpGet(config, `/o/headless-commerce-admin-catalog/v1.0/specifications?${params.toString()}`);
        }
        const items = Array.isArray(res?.items) ? res.items : [];
        for (const sp of items) {
          try {
            if (!sp?.id) continue;
            if (typeof liferay.deleteSpecificationById === 'function') {
              await liferay.deleteSpecificationById(config, sp.id);
            } else if (typeof liferay.httpDelete === 'function') {
              await liferay.httpDelete(config, `/o/headless-commerce-admin-catalog/v1.0/specifications/${sp.id}`);
            }
            totalDeleted++;
            logger.info('Deleted specification (search fallback)', { id: sp.id, key: sp.key });
          } catch (e) {
            logger.debug('Failed to delete specification (search fallback)', { id: sp.id, error: e.message });
          }
        }
      } catch (e) {
        logger.debug('Specification search failed', { prefix, error: e.message });
      }
    }
    return { deleted: totalDeleted };
  }

  async runDeleteAndMonitor(config, options = {}) {
    const { liferay } = this.ctx;

    const baseOpts = {
      ...options,
      importStrategy: options.importStrategy || 'ON_ERROR_CONTINUE',
    };
    const callbackUrl =
      config.microserviceUrl && config.microserviceUrl !== 'null'
        ? `${config.microserviceUrl}/api/batch/callback`
        : null;

    const orders = await liferay.deleteCommerceOrders(
      config,
      baseOpts,
      callbackUrl
    );
    if (orders?.batchRefs)
      this.recordBatches(
        orders.batchRefs,
        config,
        'orders',
        this._deriveTotalFromResult(orders)
      );
    await this._waitForBatches(orders?.batchRefs, config, 'orders');

    const accounts = await liferay
      .deleteCommerceAccounts(config, baseOpts, callbackUrl)
      .catch(() => null);
    if (accounts?.batchRefs)
      this.recordBatches(
        accounts.batchRefs,
        config,
        'accounts',
        this._deriveTotalFromResult(accounts)
      );
    await this._waitForBatches(accounts?.batchRefs, config, 'accounts');

    const products = await liferay.deleteCommerceProducts(
      config,
      baseOpts,
      callbackUrl
    );
    if (products?.batchRefs)
      this.recordBatches(
        products.batchRefs,
        config,
        'products',
        this._deriveTotalFromResult(products)
      );
    await this._waitForBatches(products?.batchRefs, config, 'products');

    await new Promise((r) => setTimeout(r, 1500));

    const specSearchPrefixes = (options?.productCategories || []).map((c) => `${String(c).toLowerCase()}-`);
    const specifications = await liferay.deleteSpecificationsBatch(
      config,
      { ...baseOpts, searchPrefixes: specSearchPrefixes },
      callbackUrl
    );
    if (specifications?.batchRefs)
      this.recordBatches(
        specifications.batchRefs,
        config,
        'specifications',
        this._deriveTotalFromResult(specifications)
      );
    await this._waitForBatches(
      specifications?.batchRefs,
      config,
      'specifications'
    );

    if (!specifications?.batchRefs || specifications?.batchRefs?.length === 0) {
      if (this._deleteSpecificationsBySearch) {
        await this._deleteSpecificationsBySearch(config, options).catch(() => {});
      }
    }

    const optionsRes = await liferay.deleteOptionsBatch(
      config,
      baseOpts,
      callbackUrl
    );
    if (optionsRes?.batchRefs)
      this.recordBatches(
        optionsRes.batchRefs,
        config,
        'options',
        this._deriveTotalFromResult(optionsRes)
      );
    await this._waitForBatches(optionsRes?.batchRefs, config, 'options');

    try {
      this.ctx.logger.info('Preparing option category deletion');

      try {
        const res = await this._listOptionCategories(config, { pageSize: 200 });
        const count = Array.isArray(res?.items) ? res.items.length : 0;
        this.ctx.logger.info('Pre-delete: total option categories', { count });
      } catch (e) {
        this.ctx.logger.debug('Pre-delete list failed for option categories', { error: e.message });
      }

      await new Promise((r) => setTimeout(r, 1500));

      this.ctx.logger.info('Submitting batch delete for option categories');
      const optionCategories = await liferay.deleteOptionCategoriesBatch(
        config,
        { ...baseOpts, all: true },
        callbackUrl
      );
      if (optionCategories?.batchRefs)
        this.recordBatches(
          optionCategories.batchRefs,
          config,
          'optionCategories',
          this._deriveTotalFromResult(optionCategories)
        );
      await this._waitForBatches(
        optionCategories?.batchRefs,
        config,
        'optionCategories'
      );

      if (!optionCategories?.batchRefs || optionCategories?.batchRefs?.length === 0) {
        await this._deleteOptionCategoriesDirect(config, options).catch(() => {});
        await this._deleteOptionCategoriesBySearch(config, options).catch(() => {});
      }

      try {
        const res = await this._listOptionCategories(config, { pageSize: 200 });
        const count = Array.isArray(res?.items) ? res.items.length : 0;
        this.ctx.logger.info('Post-delete: total option categories', { count });
      } catch (e) {
        this.ctx.logger.debug('Post-delete list failed for option categories', { error: e.message });
      }
    } catch (e) {
      this.ctx.logger.error('Option category delete stage failed', { error: e.message });
    }

    return {
      orders,
      accounts,
      products,
      specifications,
      options: optionsRes
    };
  }
}

module.exports = DeleteCoordinatorService;
