const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

const BATCH_STEP_HANDLERS = require('./batch-steps/index.cjs');

class BatchCallbackService {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async _checkSessionCompletion(sessionId, correlationId) {
    const { logger, persistence, ws } = this.ctx;
    
    const session = await persistence.getSession(sessionId);
    if (!session || session.status === 'COMPLETED' || session.status === 'FAILED') {
      return;
    }

    const { config, steps: workflowSteps } = session.context;
    let { currentSteps } = session; // This now holds the array of currently active steps (objects or strings)

    const allBatchesForSession = await persistence.getBatchesForSession(sessionId);

    logger.info('_checkSessionCompletion: details', {
      sessionId,
      currentSteps,
      allBatchesForSession,
    });

    let newActiveSteps = [];
    let sessionAdvanced = false;

    // Process all currently active steps
    for (const stepDefinition of currentSteps) {
      const stepName = typeof stepDefinition === 'string' ? stepDefinition : stepDefinition.name;
      const stepType = typeof stepDefinition === 'object' ? stepDefinition.type : 'sync'; // Default to sync

      const batchesForCurrentStep = allBatchesForSession.filter(b => b.step_key === stepName);
      const isStepCompleted = batchesForCurrentStep.every(b => b.status === 'COMPLETED' || b.status === 'FAILED');
      const isStepFailed = batchesForCurrentStep.some(b => b.status === 'FAILED');

      if (isStepFailed) {
        logger.error(`Step '${stepName}' failed. Marking session as failed.`, { sessionId, stepName });
        await persistence.updateSession(sessionId, { status: 'FAILED' });
        return;
      }

      if (isStepCompleted) {
        logger.info(`Step '${stepName}' completed.`, { sessionId, stepName, stepType });
        sessionAdvanced = true;
        // Do not add to newActiveSteps, effectively removing it
        if (stepType === 'async') {
          logger.info(`Asynchronous step '${stepName}' finished, not blocking workflow.`, { sessionId, stepName });
        }
      } else {
        // If not completed, keep it in the list of active steps
        newActiveSteps.push(stepDefinition);
      }
    }

    // Update currentSteps in DB after processing completions
    currentSteps = newActiveSteps;
    await persistence.updateSessionCurrentSteps(sessionId, currentSteps);

    let nextWorkflowStepIndex;

    // If no steps are currently active, try to advance the workflow
    if (currentSteps.length === 0) {
      const lastCompletedStepIndex = workflowSteps.findLastIndex(s => {
        const sName = typeof s === 'string' ? s : s.name;
        return allBatchesForSession.some(b => b.step_key === sName && (b.status === 'COMPLETED' || b.status === 'FAILED'));
      });

      nextWorkflowStepIndex = (lastCompletedStepIndex !== -1) ? lastCompletedStepIndex + 1 : 0;
      let nextWorkflowStep = workflowSteps[nextWorkflowStepIndex];

      while (nextWorkflowStep) {
        const nextStepName = typeof nextWorkflowStep === 'string' ? nextWorkflowStep : nextWorkflowStep.name;
        const nextStepType = typeof nextWorkflowStep === 'object' ? nextWorkflowStep.type : 'sync';

        if (nextStepType === 'sync') {
          logger.info(`Starting synchronous step '${nextStepName}'`, { sessionId, nextStepName });
          currentSteps.push(nextWorkflowStep);
          await persistence.updateSessionCurrentSteps(sessionId, currentSteps);
          await this._startStep(nextWorkflowStep, sessionId, config, correlationId);
          break; // Wait for this sync step to complete
        } else if (nextStepType === 'async') {
          logger.info(`Starting asynchronous step '${nextStepName}'`, { sessionId, nextStepName });
          // Async steps are added to currentSteps but don't block progress
          currentSteps.push(nextWorkflowStep);
          await persistence.updateSessionCurrentSteps(sessionId, currentSteps);
          await this._startStep(nextWorkflowStep, sessionId, config, correlationId);
          // Immediately move to the next step
          nextWorkflowStepIndex++;
          nextWorkflowStep = workflowSteps[nextWorkflowStepIndex];
        } else if (nextStepType === 'parallel') {
          logger.info(`Starting parallel step block`, { sessionId, nextStepName: nextWorkflowStep.name });
          for (const subStep of nextWorkflowStep.steps) {
            logger.info(`Starting parallel sub-step '${subStep.name}'`, { sessionId, subStepName: subStep.name });
            currentSteps.push(subStep);
            await this._startStep(subStep, sessionId, config, correlationId);
          }
          await persistence.updateSessionCurrentSteps(sessionId, currentSteps);
          // After starting all parallel sub-steps, this parallel block is now active, so we break and wait.
          break;
        } else {
          logger.warn(`Unknown step type '${nextStepType}' for step '${nextStepName}'`, { sessionId, nextStepName });
        }
        // This is for async steps and iterating through a parallel block's setup
        nextWorkflowStepIndex++;
        nextWorkflowStep = workflowSteps[nextWorkflowStepIndex];
      }
    }

    // Final check for session completion if no current steps are active and no more workflow steps
    if (currentSteps.length === 0 && !workflowSteps[nextWorkflowStepIndex]) {
      logger.info('Workflow session completed - all steps finished', {
        operation: 'session-complete',
        correlationId,
        sessionId,
        flowType: session.flow_type,
        totalBatches: allBatchesForSession.length,
      });

      await persistence.updateSession(sessionId, { status: 'COMPLETED', currentSteps: [] });

      const onSessionComplete = this._getOnSessionComplete(session.flow_type);

      if (typeof onSessionComplete === 'function') {
        Promise.resolve()
          .then(() =>
            onSessionComplete({
              sessionId,
              session: {
                ...session.context,
                completedBatches: allBatchesForSession.map((b) => b.downstream_batch_id),
              },
              correlationId,
            })
          )
          .catch((err) => {
            const errorReference = err.errorReference || createERC(ERC_PREFIX.ERROR);
            logger?.error?.('onSessionComplete failed', {
              operation: 'post-processing-hook-error',
              sessionId,
              correlationId,
              errorReference,
              message: err.message,
              stack: err.stack,
            });
          });
      }
    } else if (sessionAdvanced) {
        // If the session advanced, ensure the DB is updated with the latest currentSteps
        // (This was already done inside the loop, but this ensures final state for this iteration)
        await persistence.updateSessionCurrentSteps(sessionId, currentSteps);
    }
  }

  async _startStep(stepDefinition, sessionId, config, correlationId) {
    const {
      logger,
      productGenerator,
      accountGenerator,
      orderGenerator,
      persistence,
    } = this.ctx;
    const session = await persistence.getSession(sessionId);

    const stepName =
      typeof stepDefinition === 'string'
        ? stepDefinition
        : stepDefinition.name;

    if (!session || !session.context) {
      logger.error(
        `Cannot start step '${stepName}': Session or session context missing.`,
        { sessionId, stepName }
      );
      await persistence.updateSession(sessionId, { status: 'FAILED' });
      return;
    }

    const { flow_type: flowType } = session;

    logger.info(
      `Attempting to start step handler for '${stepName}' (Flow: ${flowType})`,
      { sessionId, stepName, flowType }
    );

    try {
      const {
        productGenerator,
        accountGenerator,
        orderGenerator,
      } = this.ctx;

      const generatorMap = {
        generate: productGenerator,
        accounts: accountGenerator,
        orders: orderGenerator,
      };

      if (flowType === 'generate') {
        const allGenerationSteps = {
          ...productGenerator.steps,
          ...accountGenerator.steps,
          ...orderGenerator.steps,
        };

        const stepHandler = allGenerationSteps[stepName];

        if (typeof stepHandler === 'function') {
          await stepHandler(sessionId, session);
        } else {
          logger.warn(
            `No generation handler found for step '${stepName}'`,
            { sessionId, stepName, flowType }
          );
          await persistence.createBatch({
            erc: createERC(ERC_PREFIX.BATCH),
            sessionId,
            step_key: stepName,
            status: 'COMPLETED',
          });
          await this._checkSessionCompletion(sessionId, correlationId);
        }
      } else if (generatorMap[flowType]) {
        const generator = generatorMap[flowType];
        const stepHandler = generator.steps[stepName];

        if (typeof stepHandler === 'function') {
          await stepHandler(sessionId, session);
        } else {
          logger.warn(
            `No handler found for step '${stepName}' in flow '${flowType}'`,
            { sessionId }
          );
          await persistence.createBatch({
            erc: createERC(ERC_PREFIX.BATCH),
            sessionId,
            step_key: stepName,
            status: 'COMPLETED',
          });
          await this._checkSessionCompletion(sessionId, correlationId);
        }
      } else if (flowType === 'delete') {
        const { channelId, catalogId } = session.context;
        await this._runStep(stepName, {
          sessionId,
          config,
          options: session.context.options,
          channelId,
          catalogId,
        });
      } else {
        logger.warn(
          `No handler found for step '${stepName}' in flow '${flowType}'`,
          { sessionId }
        );
        await persistence.createBatch({
          erc: createERC(ERC_PREFIX.BATCH),
          sessionId,
          step_key: stepName,
          status: 'COMPLETED',
        });
        await this._checkSessionCompletion(sessionId, correlationId);
      }
    } catch (error) {
      logger.error(`Error executing step '${stepName}': ${error.message}`, {
        sessionId,
        stepName,
        flowType,
        error: error.message,
        stack: error.stack,
      });
      await persistence.updateSession(sessionId, { status: 'FAILED' });
    }
  }


  async _runStep(step, { sessionId, config, options, channelId, catalogId }) {
    const { logger, liferay, persistence } = this.ctx;

    const batchERC = createERC(ERC_PREFIX.BATCH_DELETION);

    await persistence.createBatch({
      erc: batchERC,
      sessionId,
      step_key: step,
      status: 'PREPARED',
    });

    const { hasItems, ids } = await this._checkIfEntitiesExist(
      liferay,
      config,
      step,
      { channelId, catalogId }
    );

    if (!hasItems) {
      logger.info(`Skipping ${step}: No entities found. Marking as complete.`, {
        batchERC,
        step,
      });

      await persistence.updateBatch(batchERC, { status: 'COMPLETED' });

      await this._checkSessionCompletion(
        sessionId,
        config.correlationId
      );

      return;
    }

    const handler = BATCH_STEP_HANDLERS[step];

    if (handler) {
      const handlerContext = {
        config,
        options,
        ids,
        batchERC,
        sessionId,
      };

      await handler(this.ctx, handlerContext);
    } else {
      logger.warn(`Unknown step in deletion process: ${step}`, {
        batchERC,
      });

      await persistence.updateBatch(batchERC, { status: 'FAILED' });
      
      await this._checkSessionCompletion(
        sessionId,
        config.correlationId
      );
    }
  }

  async _checkIfEntitiesExist(liferay, config, entityType, context) {
    const { logger } = this.ctx;
    const { channelId, catalogId, productIds } = context;

    logger.debug('Checking for existence of entities', {
      entityType,
      channelId,
      catalogId,
      operation: context.options?.operation,
    });

    const checkMap = {
      deleteAccounts: async () => {
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
      deleteProducts: async () => {
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
      deleteSpecifications: async () => {
        const res = await liferay.getSpecifications(config, { pageSize: 200 });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
      deleteOptions: async () => {
        const res = await liferay.getOptions(config, { pageSize: 200 });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
      deleteOptionCategories: async () => {
        const res = await liferay.getOptionCategories(config, {
          pageSize: 200,
        });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
      deleteProductRelatedEntities: async () => {
        if (!productIds || productIds.length === 0) {
          return { hasItems: false, ids: [] };
        }
        const specifications = await liferay.getSpecificationsByProductIds(
          config,
          productIds
        );
        return {
          hasItems: specifications.length > 0,
          ids: specifications.map((s) => s.id),
        };
      },
      deleteOrders: async () => {
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
      deleteWarehouses: async () => {
        const res = await liferay.getWarehousesPage(config, { pageSize: 200 });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
      deletePriceLists: async () => {
        const res = await liferay.getPriceLists(config, { pageSize: 200 });
        return {
          items: liferay._asItems(res),
          totalCount: liferay._asCount(res),
          ids: liferay._asItems(res).map((it) => it.id),
        };
      },
    };

    if (!checkMap[entityType]) return { hasItems: false, ids: [] }; 

    const { items, totalCount, ids } = await checkMap[entityType]();
    const hasItems = totalCount > 0;

    logger.debug('Entity existence check result', {
      entityType,
      hasItems,
      totalCount,
      resultItemsPreview: (ids || []).slice(0, 5),
    });

    return { hasItems: hasItems, ids: ids };
  }

  _getOnSessionComplete(flowType) {
    return null;
  }

  async processCallback(batchERC, payload) {
    const { logger, liferay, persistence, ws } = this.ctx;

    const dbBatch = await persistence.getBatch(batchERC);

    if (!dbBatch) {
      logger.warn('No batch record found for batchERC in callback', {
        batchERC,
        payload,
        operation: 'batch-callback-no-record',
      });
      return;
    }

    const session = await persistence.getSession(dbBatch.session_id);
    if (!session) {
      logger.error('Orphaned batch detected - no session found for batch', {
        operation: 'batch-callback-no-session',
        batchERC,
        sessionId: dbBatch.session_id,
      });
      await persistence.updateBatch(batchERC, { status: 'FAILED' });
      return;
    }

    const { config } = session.context;
    const correlationId = config.correlationId;

    const batchId = Object.keys(payload)[0];
    const status = payload[batchId];

    if (!batchId) {
      logger.error('Could not extract batchId from callback payload', {
        payload,
        operation: 'batch-callback-bad-payload',
      });
      return;
    }

    try {
      const importTask = await liferay.getImportTask(config, batchId);
      const { processedItemsCount, totalItemsCount, failedItems } =
        importTask.data;
      const errorCount = failedItems?.length || 0;

      await persistence.updateBatch(batchERC, {
        status: status.toUpperCase(),
        processedCount: processedItemsCount,
        totalCount: totalItemsCount,
        errorCount: errorCount,
        downstreamBatchId: batchId,
      });

      ws.emitBatchCompleted(
        {
          entityType: dbBatch.step_key,
          operation: session.flow_type,
          batchId: batchId,
          batchERC: batchERC,
          sessionId: dbBatch.session_id,
          successCount: processedItemsCount,
          failureCount: errorCount,
          errors: failedItems?.slice(0, 5) || [],
        },
        { correlationId }
      );

      await this._checkSessionCompletion(dbBatch.session_id, correlationId);
    } catch (error) {
      logger.error('Error processing batch callback', {
        operation: 'batch-callback-error',
        batchERC,
        correlationId,
        message: error.message,
      });

      await persistence.updateBatch(batchERC, { status: 'FAILED' });
    }
  }
}

module.exports = BatchCallbackService;