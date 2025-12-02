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
    const groups = [];
    const used = new Set();
    if (steps.includes('orders')) {
      groups.push(['orders']);
      used.add('orders');
    }
    const ap = ['accounts', 'products'].filter((x) => steps.includes(x));
    if (ap.length) {
      groups.push(ap);
      ap.forEach((x) => used.add(x));
    }
    const sooc = ['specifications', 'options', 'optionCategories'].filter((x) =>
      steps.includes(x)
    );
    if (sooc.length) {
      groups.push(sooc);
      sooc.forEach((x) => used.add(x));
    }
    for (const s of steps) {
      if (!used.has(s)) {
        groups.push([s]);
        used.add(s);
      }
    }
    return groups;
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
    const { logger, cache } = this.ctx;
    let startedAny = false;
    for (
      let groupIndex = fromGroupIndex + 1;
      groupIndex < context.stepGroups.length;
      groupIndex++
    ) {
      const group = context.stepGroups[groupIndex];
      const started = [];
      for (const step of group) {
        if (context.completedSteps.includes(step)) {
          continue;
        }
        const hasEntities = await this._checkIfEntitiesExist(
          liferay,
          config,
          step,
          { channelId, catalogId }
        );
        if (!hasEntities) {
          context.completedSteps.push(step);
          logger.info(
            `Skipping ${step} deletion: No entities found. Marking as completed.`,
            { batchERC, step }
          );
          continue;
        }
        let result;
        const nextCallbackUrl = `${callbackUrl}&entity=${step}`;
        switch (step) {
          case 'accounts':
            result = await liferay.deleteCommerceAccounts(
              config,
              { ...options, channelId },
              nextCallbackUrl
            );
            break;
          case 'products': {
            if (catalogId) {
              const productConfig = { ...config, catalogId };
              result = await liferay.deleteCommerceProducts(
                productConfig,
                { ...options, catalogId },
                nextCallbackUrl
              );
            } else {
              result = await liferay.deleteAllCommerceProducts(
                config,
                options,
                nextCallbackUrl
              );
            }
            break;
          }
          case 'specifications':
            result = await liferay.deleteSpecificationsBatch(
              config,
              { ...options, all: true },
              nextCallbackUrl
            );
            break;
          case 'options':
            result = await liferay.deleteOptionsBatch(
              config,
              options,
              nextCallbackUrl
            );
            break;
          case 'optionCategories':
            result = await liferay.deleteOptionCategoriesBatch(
              config,
              { ...options, all: true },
              nextCallbackUrl
            );
            break;
          case 'orders':
            result = await liferay.deleteCommerceOrders(
              config,
              { ...options, channelId },
              nextCallbackUrl
            );
            break;
          default:
            logger.warn(`Unknown step in chained deletion: ${step}`, {
              batchERC,
            });
            continue;
        }
        if (result?.batchRefs && result.batchRefs.length > 0) {
          logger.info('Batch tasks started for chained deletion', {
            batchERC,
            step,
            batchRefs: result.batchRefs,
          });
        }
        if (result?.batchRefs && deleteCoordinatorService?.recordBatches) {
          deleteCoordinatorService.recordBatches(
            result.batchRefs,
            config,
            step,
            deleteCoordinatorService._deriveTotalFromResult(result)
          );
        } else if (
          result?.batchRefs &&
          !deleteCoordinatorService?.recordBatches
        ) {
          logger.warn(
            'deleteCoordinatorService is not available; skipping batch recording',
            {
              batchERC,
              step,
              operation: 'batch-callback-missing-delete-coordinator-service',
            }
          );
        }
        started.push(step);
      }
      context.completedSteps = Array.from(new Set(context.completedSteps));
      context.currentGroupIndex = groupIndex;
      cache.set(`batch:${batchERC}:context`, context);
      if (started.length > 0) {
        logger.info(
          `Started next group of chained deletion: group ${groupIndex} [${started.join(
            ', '
          )}]`,
          {
            batchERC,
            started,
            group,
          }
        );
        return;
      }
      if (!this._isGroupComplete(group, context.completedSteps)) {
        logger.warn(`Group ${groupIndex} not fully complete after skip logic`, {
          batchERC,
          group,
          completedSteps: context.completedSteps,
        });
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
    const checkMap = {
      accounts: () =>
        liferay.getCommerceAccounts(config, { channelId, pageSize: 1 }),
      products: () =>
        liferay.getCommerceProducts(config, { catalogId, pageSize: 1 }),
      specifications: () => liferay.getSpecifications(config, { pageSize: 1 }),
      options: () => liferay.getOptions(config, { pageSize: 1 }),
      optionCategories: () =>
        liferay._listOptionCategories(config, { pageSize: 1 }),
    };

    if (!checkMap[entityType]) return true; // Assume existence if no check is defined

    const result = await checkMap[entityType]();
    if (entityType === 'accounts') {
      const totalCount =
        typeof result?.totalCount === 'number'
          ? result.totalCount
          : Array.isArray(result?.items)
          ? result.items.length
          : 0;

      if (totalCount <= 1) {
        if (logger?.isTraceEnabled?.()) {
          logger.trace(
            'Account existence check: skipping accounts step because at most one account exists',
            {
              entityType,
              totalCount,
              itemsPreview: JSON.stringify(
                (result?.items || []).slice(0, 5),
                null,
                2
              ),
            }
          );
        }
        return false;
      }

      const primaryAccountId = await liferay.getPrimaryAccountId(config);
      if (primaryAccountId != null && Array.isArray(result?.items)) {
        const deletable = result.items.filter(
          (it) => String(it.id) !== String(primaryAccountId)
        );
        if (logger?.isTraceEnabled?.()) {
          logger.trace('Account existence check excluding primary account', {
            entityType,
            primaryAccountId,
            totalCount,
            deletableCount: deletable.length,
          });
        }
        return deletable.length > 0;
      }
    }
    if (logger?.isTraceEnabled?.()) {
      logger.trace('Entity existence check result', {
        entityType,
        hasItems: !!result?.items?.length,
        itemsPreview: JSON.stringify(
          (result?.items || []).slice(0, 5),
          null,
          2
        ),
        rawResultKeys: result ? Object.keys(result) : [],
      });
    }
    return result?.items?.length > 0;
  }
}

module.exports = BatchCallbackService;
