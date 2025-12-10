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
    const { logger, cache } = this.ctx;
    for (
      let groupIndex = 0;
      groupIndex < context.stepGroups.length;
      groupIndex++
    ) {
      const group = context.stepGroups[groupIndex];

      // If this group is already completed, skip to the next one
      if (this._isGroupComplete(group, context.completedSteps)) {
        logger.debug(`Group ${groupIndex} already completed. Skipping.`, {
          batchERC,
          group,
          completedSteps: context.completedSteps,
        });
        context.currentGroupIndex = groupIndex + 1; // Explicitly advance currentGroupIndex
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
          // Persist the updated context for skipped steps
          cache.set(`batch:${batchERC}:context`, context);
          continue;
        }

        let result;
        const nextCallbackUrl = `${callbackUrl}&entity=${step}`;
        logger.debug(`Attempting deletion for step: ${step}`, {
          batchERC,
          step,
          hasEntities,
        });

        switch (step) {
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
            // This step should be handled by the initial call to runDeleteAndMonitorV2
            // Mark as complete and continue to avoid re-processing
            if (!context.completedSteps.includes('orders')) {
              context.completedSteps.push('orders');
              cache.set(`batch:${batchERC}:context`, context);
            }
            continue;
          default:
            logger.warn(`Unknown step in chained deletion: ${step}`, {
              batchERC,
            });
            // Mark unknown steps as complete to avoid infinite loops if they can't be processed
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
          // Important: after submitting a batch, we MUST wait for its callback
          // So we update the current group index and break from the inner loop
          // The next processCallback call will then resume from this group
          context.currentGroupIndex = groupIndex;
          cache.set(`batch:${batchERC}:context`, context);
          logger.info(
            `Submitted batch for step '${step}'. Waiting for its completion.`,
            { batchERC, step }
          );
          return; // Exit here and wait for callback to re-trigger processCallback
        }
        // If entities existed but no batches were submitted, it means they were handled
        // (e.g., deleted individually, or no actual deletion needed but existence confirmed)
        context.completedSteps.push(step);
        logger.info(
          `Step '${step}' deletion initiated or marked complete (no batches needed).`,
          { batchERC, step }
        );
        // Persist context after marking step complete, even if no batch was submitted
        cache.set(`batch:${batchERC}:context`, context);
      } // End of inner loop (for step of group)

      context.completedSteps = Array.from(new Set(context.completedSteps)); // Ensure uniqueness

      // After trying all steps in the current group, if it's not fully complete,
      // it means some deletion was initiated and we are waiting for its callback (handled by the 'return' above)
      // or something went wrong. But if it is complete, we can move to the next group.
      if (this._isGroupComplete(group, context.completedSteps)) {
        logger.info(
          `Group ${groupIndex} completed. Proceeding to next group.`,
          { batchERC, group }
        );
        context.currentGroupIndex = groupIndex + 1; // Advance to the next group
        cache.set(`batch:${batchERC}:context`, context);
        // Continue to the next groupIndex in the outer loop
      } else {
        logger.warn(
          `Group ${groupIndex} not fully complete after processing. This might indicate an issue.`,
          {
            batchERC,
            group,
            completedSteps: context.completedSteps,
          }
        );
        return; // Stop processing to avoid infinite loops or unexpected behavior
      }
    } // End of outer loop (for groupIndex)

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
      accounts: () =>
        liferay.getCommerceAccounts(config, { channelId, pageSize: 200 }),
      products: () =>
        liferay.getCommerceProducts(config, { catalogId, pageSize: 1 }),
      specifications: () => liferay.getSpecifications(config, { pageSize: 1 }),
      options: () => liferay.getOptions(config, { pageSize: 1 }),
      optionCategories: () =>
        liferay._listOptionCategories(config, { pageSize: 1 }),
      orders: () =>
        liferay.getCommerceOrders(config, { channelId, pageSize: 1 }),
    };

    if (!checkMap[entityType]) return true; // Assume existence if no check is defined

    const result = await checkMap[entityType]();
    const hasItems = result?.items?.length > 0;
    logger.debug('Entity existence check result', {
      entityType,
      hasItems,
      result,
    });
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
