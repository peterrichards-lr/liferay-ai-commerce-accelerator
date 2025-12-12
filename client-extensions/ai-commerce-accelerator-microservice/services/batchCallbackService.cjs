const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class BatchCallbackService {
  constructor(ctx) {
    this.ctx = ctx;
    this.deleteCoordinatorService = null;
  }

  setDeleteCoordinatorService(deleteCoordinatorService) {
    this.deleteCoordinatorService = deleteCoordinatorService;
  }

  async processCallback(batchERC, payload) {
    const { cache, logger, liferay } = this.ctx;
    const deleteCoordinatorService = this.deleteCoordinatorService;
    try {
      let context = cache.get(`batch:${batchERC}:context`);
      logger.debug('Processing batch callback', { batchERC, payload, context });
      if (logger?.isTraceEnabled?.()) {
        logger.trace('Batch callback loaded context', {
          batchERC,
          hasContext: !!context,
          contextKeys: context ? Object.keys(context) : [],
          steps: context?.steps,
          currentStep: payload?.entity,
          payload: JSON.stringify(payload, null, 2),
        });
      }
      if (!context) {
        logger.warn('No context found for batchERC in callback', {
          batchERC,
          payload,
          operation: 'batch-callback-no-context',
        });
        return;
      }
      const { config, options, steps, callbackUrl, channelId, catalogId } =
        context;
      if (!context.stepGroups) {
        context.stepGroups = this._buildStepGroups(steps);
      }
      if (!Array.isArray(context.completedSteps)) {
        context.completedSteps = [];
      }
      const completedStep = payload.entity;
      if (
        steps.includes(completedStep) &&
        !context.completedSteps.includes(completedStep)
      ) {
        context.completedSteps.push(completedStep);
      }
      let groupIndex = -1;
      for (let i = 0; i < context.stepGroups.length; i++) {
        if (context.stepGroups[i].includes(completedStep)) {
          groupIndex = i;
          break;
        }
      }
      if (groupIndex === -1) {
        logger.warn(
          `Completed step '${completedStep}' not found in stepGroups for batchERC`,
          {
            batchERC,
            stepGroups: context.stepGroups,
            operation: 'batch-callback-unknown-step-group',
          }
        );
        return;
      }
      context.currentGroupIndex = Math.max(
        context.currentGroupIndex || 0,
        groupIndex
      );
      cache.set(`batch:${batchERC}:context`, context);
      const group = context.stepGroups[groupIndex];
      if (!this._isGroupComplete(group, context.completedSteps)) {
        logger.info(
          `Step '${completedStep}' completed in group ${groupIndex}, waiting for other steps in group`,
          {
            batchERC,
            completedStep,
            group,
            completedSteps: context.completedSteps,
          }
        );
        return;
      }
      await this._startNextGroups({
        batchERC,
        context,
        fromGroupIndex: groupIndex,
        config,
        options,
        callbackUrl,
        channelId,
        catalogId,
        liferay,
        deleteCoordinatorService,
      });
    } catch (error) {
      const errorReference =
        error.errorReference || createERC(ERC_PREFIX.ERROR);
      this.ctx.logger.error('Error processing batch callback', {
        operation: 'batch-callback-error',
        errorReference,
        batchERC,
        message: error.message,
        stack: error.stack,
      });
    }
  }

  _buildStepGroups(steps = []) {
    return steps.map((step) => [step]);
  }

  _isGroupComplete(group, completedSteps) {
    return group.every((step) => completedSteps.includes(step));
  }

  async _startNextGroups({
    batchERC,
    context,
    fromGroupIndex,
    config,
    options,
    callbackUrl,
    channelId,
    catalogId,
    liferay,
    deleteCoordinatorService,
  }) {
    const { logger, cache, ws } = this.ctx;
    for (
      let groupIndex = 0;
      groupIndex < context.stepGroups.length;
      groupIndex++
    ) {
      const group = context.stepGroups[groupIndex];

      if (this._isGroupComplete(group, context.completedSteps)) {
        logger.debug(`Group ${groupIndex} already completed. Skipping.`, {
          batchERC,
          group,
          completedSteps: context.completedSteps,
        });
        context.currentGroupIndex = groupIndex + 1;
        cache.set(`batch:${batchERC}:context`, context);
        continue;
      }

      let batchesSubmittedInGroup = 0;

      for (const step of group) {
        if (context.completedSteps.includes(step)) {
          logger.debug(`Step '${step}' already completed. Skipping.`, {
            batchERC,
            step,
          });
          continue;
        }

        const { hasItems, ids } = await this._checkIfEntitiesExist(
          liferay,
          config,
          step,
          { channelId, catalogId }
        );

        if (!hasItems) {
          context.completedSteps.push(step);
          logger.info(
            `Skipping ${step} deletion: No entities found. Marking as completed.`,
            { batchERC, step }
          );

          cache.set(`batch:${batchERC}:context`, context);
          continue;
        }

        let result;
        const nextCallbackUrl = `${callbackUrl}&entity=${step}`;
        logger.debug(`Attempting deletion for step: ${step}`, {
          batchERC,
          step,
          hasItems,
          ids: (ids || []).slice(0, 5),
        });

        switch (step) {
          case 'orders':
            result = await liferay.deleteCommerceOrders(
              config,
              { ...options, channelId, callbackBatchERC: batchERC },
              nextCallbackUrl
            );
            break;
          case 'warehouses':
            result = await deleteCoordinatorService._deleteWarehouses(
              config,
              ids,
              config.correlationId,
              ws
            );
            break;
          case 'accounts':
            result = await liferay.deleteCommerceAccounts(
              config,
              { ...options, channelId, callbackBatchERC: batchERC },
              nextCallbackUrl
            );
            break;
          case 'products': {
            if (catalogId) {
              const productConfig = { ...config, catalogId };
              result = await liferay.deleteCommerceProducts(
                productConfig,
                { ...options, catalogId, callbackBatchERC: batchERC },
                nextCallbackUrl
              );
            } else {
              result = await liferay.deleteAllCommerceProducts(
                config,
                { ...options, callbackBatchERC: batchERC },
                nextCallbackUrl
              );
            }
            break;
          }
          case 'specifications':
            result = await liferay.deleteSpecificationsBatch(
              config,
              { ...options, all: true, callbackBatchERC: batchERC },
              nextCallbackUrl
            );
            break;
          case 'options':
            result = await liferay.deleteOptionsBatch(
              config,
              { ...options, callbackBatchERC: batchERC },
              nextCallbackUrl
            );
            break;
          case 'optionCategories':
            result = await liferay.deleteOptionCategoriesBatch(
              config,
              { ...options, all: true, callbackBatchERC: batchERC },
              nextCallbackUrl
            );
            break;
          case 'orders':
            logger.warn(
              `Orders step encountered in _startNextGroups loop. This should not happen.`,
              { batchERC }
            );
            if (!context.completedSteps.includes('orders')) {
              context.completedSteps.push('orders');
              cache.set(`batch:${batchERC}:context`, context);
            }
            continue;
          default:
            logger.warn(`Unknown step in chained deletion: ${step}`, {
              batchERC,
            });
            if (!context.completedSteps.includes(step)) {
              context.completedSteps.push(step);
              cache.set(`batch:${batchERC}:context`, context);
            }
            continue;
        }

        if (result?.batchRefs && result.batchRefs.length > 0) {
          logger.info('Batch tasks started for chained deletion', {
            batchERC,
            step,
            batchRefs: result.batchRefs,
          });
          batchesSubmittedInGroup++;
          context.currentGroupIndex = groupIndex;
          cache.set(`batch:${batchERC}:context`, context);
          logger.info(
            `Submitted batch for step '${step}'. Waiting for its completion.`,
            { batchERC, step }
          );
          return;
        }

        context.completedSteps.push(step);
        logger.info(
          `Step '${step}' deletion initiated or marked complete (no batches needed).`,
          { batchERC, step }
        );
        cache.set(`batch:${batchERC}:context`, context);
      }

      context.completedSteps = Array.from(new Set(context.completedSteps));

      if (this._isGroupComplete(group, context.completedSteps)) {
        logger.info(
          `Group ${groupIndex} completed. Proceeding to next group.`,
          { batchERC, group }
        );
        context.currentGroupIndex = groupIndex + 1;
        cache.set(`batch:${batchERC}:context`, context);
      } else {
        logger.warn(
          `Group ${groupIndex} not fully complete after processing. This might indicate an issue.`,
          {
            batchERC,
            group,
            completedSteps: context.completedSteps,
          }
        );
        return;
      }
    }

    logger.info('Chained deletion process complete.', {
      batchERC,
      operation: 'batch-callback-complete',
    });
    this.ctx.cache.delete(`batch:${batchERC}:context`);
  }

  async _checkIfEntitiesExist(
    liferay,
    config,
    entityType,
    { channelId, catalogId }
  ) {
    const { logger } = this.ctx;
    logger.debug('Checking for existence of entities', {
      entityType,
      channelId,
      catalogId,
    });
    const checkMap = {
      accounts: async () => {
        const res = await liferay.getCommerceAccounts(config, {
          channelId,
          pageSize: 200,
        });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
      products: async () => {
        const res = await liferay.getCommerceProducts(config, {
          catalogId,
          pageSize: 200,
        });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.productId),
        };
      },
      specifications: async () => {
        const res = await liferay.getSpecifications(config, { pageSize: 200 });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
      options: async () => {
        const res = await liferay.getOptions(config, { pageSize: 200 });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
      optionCategories: async () => {
        const res = await liferay._listOptionCategories(config, {
          pageSize: 200,
        });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
      orders: async () => {
        const res = await liferay.getCommerceOrders(config, {
          channelId,
          pageSize: 200,
        });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
      warehouses: async () => {
        const res = await liferay.getWarehouses(config, { pageSize: 200 });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
    };

    if (!checkMap[entityType]) return { hasItems: true, ids: [] };

    const { items, totalCount, ids } = await checkMap[entityType]();
    const hasItems = totalCount > 0;

    logger.debug('Entity existence check result', {
      entityType,
      hasItems,
      totalCount,
      resultItemsPreview: (ids || []).slice(0, 5),
    });

    if (entityType === 'accounts') {
      if (totalCount <= 1) {
        const primaryAccountId = await liferay.getPrimaryAccountId(config);
        const deletableIds = (ids || []).filter(
          (id) => String(id) !== String(primaryAccountId)
        );
        logger.trace('Account existence check excluding primary account', {
          entityType,
          primaryAccountId,
          totalCount,
          deletableCount: deletableIds.length,
        });
        return { hasItems: deletableIds.length > 0, ids: deletableIds };
      }
    }

    return { hasItems: hasItems, ids: ids };
  }
}

module.exports = BatchCallbackService;
