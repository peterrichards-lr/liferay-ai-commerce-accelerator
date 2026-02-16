const { createERC } = require('../../utils/misc.cjs');
const { ERC_PREFIX } = require('../../utils/constants.cjs');

const BATCH_STEP_HANDLERS = require('./batch-steps/index.cjs');

class BatchCallbackService {
  constructor(ctx) {
    this.ctx = ctx;
  }

  _isBatchTerminal(batch) {
    return (
      batch.status === 'COMPLETED' ||
      batch.status === 'FAILED' ||
      batch.status === 'BYPASSED' ||
      batch.status === 'SYNCHRONOUS'
    );
  }

  async _checkSessionCompletion(sessionId, correlationId) {
    const { logger, persistence } = this.ctx;
    
    const session = await persistence.getSession(sessionId);
    if (!session || session.status === 'COMPLETED' || session.status === 'FAILED') {
      return;
    }

    const allBatchesForSession = await persistence.getBatchesForSession(sessionId);

    const { activeSteps, hasFailures } = await this._updateActiveSteps(session, allBatchesForSession);

    if (hasFailures) {
      await persistence.updateSession(sessionId, { status: 'FAILED' });
      return;
    }
    
    let currentSteps = activeSteps;
    await persistence.updateSessionCurrentSteps(sessionId, currentSteps);

    if (currentSteps.length === 0) {
      const advancedSteps = await this._advanceWorkflow(session, allBatchesForSession, correlationId);
      currentSteps = advancedSteps;
      await persistence.updateSessionCurrentSteps(sessionId, currentSteps);
    }
    
    const workflowFinished = await this._isWorkflowFinished(session, currentSteps, allBatchesForSession);

    if (workflowFinished) {
      await this._finalizeSession(session, allBatchesForSession, correlationId);
    }
  }

  async _updateActiveSteps(session, allBatchesForSession) {
    const { logger } = this.ctx;
    const { session_id: sessionId, currentSteps } = session;

    let hasFailures = false;
    const nextActiveSteps = [];

    for (const stepDefinition of currentSteps) {
      const stepName = typeof stepDefinition === 'string' ? stepDefinition : stepDefinition.name;
      const stepType = typeof stepDefinition === 'object' ? stepDefinition.type : 'sync';

      const batchesForStep = allBatchesForSession.filter(b => b.step_key === stepName);
      const isStepCompleted = batchesForStep.length > 0 && batchesForStep.every(b => this._isBatchTerminal(b));
      const isStepFailed = batchesForStep.some(b => b.status === 'FAILED');

      if (isStepFailed) {
        logger.error(`Step '${stepName}' failed.`, { sessionId, stepName });
        hasFailures = true;
        break; 
      }

      if (isStepCompleted) {
        logger.info(`Step '${stepName}' completed.`, { sessionId, stepName, stepType });
        if (stepType === 'async') {
          logger.info(`Asynchronous step '${stepName}' finished, not blocking workflow.`, { sessionId, stepName });
        }
      } else {
        nextActiveSteps.push(stepDefinition);
      }
    }

    return { activeSteps: nextActiveSteps, hasFailures };
  }

  _areAllStepsComplete(steps, completedStepNames) {
    return steps.every(s => completedStepNames.has(s.name));
  }

  async _advanceWorkflow(session, allBatchesForSession, correlationId) {
    const { logger, persistence } = this.ctx;
    const { session_id: sessionId, context: { config, steps: workflowSteps } } = session;
    
    const newActiveSteps = [];

    const completedStepNames = new Set(allBatchesForSession.filter(b => this._isBatchTerminal(b)).map(b => b.step_key));

    for (const step of workflowSteps) {
      if (step.type === 'parallel') {
        if (this._areAllStepsComplete(step.steps, completedStepNames)) {
          continue;
        }

        for (const subStep of step.steps) {
          if (!completedStepNames.has(subStep.name)) {
            logger.info(`Starting parallel sub-step '${subStep.name}'`, { sessionId, subStepName: subStep.name });
            newActiveSteps.push(subStep);
            await this._startStep(subStep, sessionId, config, correlationId);
          }
        }
        return newActiveSteps;
      }
      else {
        const stepName = typeof step === 'string' ? step : step.name;
        if (!completedStepNames.has(stepName)) {
          logger.info(`Starting synchronous step '${stepName}'`, { sessionId, nextStepName: stepName });
          newActiveSteps.push(step);
          await this._startStep(step, sessionId, config, correlationId);
          return newActiveSteps;
        }
      }
    }

    return newActiveSteps;
  }
  
  async _isWorkflowFinished(session, currentSteps, allBatchesForSession) {
    const { steps: workflowSteps } = session.context;
  
    if (currentSteps.length > 0) {
      return false;
    }
  
    const completedStepNames = new Set(allBatchesForSession.filter(b => this._isBatchTerminal(b)).map(b => b.step_key));
  
    for (const step of workflowSteps) {
      if (step.type === 'parallel') {
        if (!this._areAllStepsComplete(step.steps, completedStepNames)) {
          return false;
        }
      } else {
        const stepName = typeof step === 'string' ? step : step.name;
        if (!completedStepNames.has(stepName)) {
          return false;
        }
      }
    }
  
    return true;
  }
  
  async _finalizeSession(session, allBatchesForSession, correlationId) {
      const { logger, persistence } = this.ctx;
      const { session_id:sessionId, flow_type, context } = session;

      logger.info('Workflow session completed - all steps finished', {
        operation: 'session-complete',
        correlationId,
        sessionId,
        flowType: flow_type,
        totalBatches: allBatchesForSession.length,
      });

      await persistence.updateSession(sessionId, { status: 'COMPLETED', currentSteps: [] });

      const onSessionComplete = this._getOnSessionComplete(flow_type);
      if (typeof onSessionComplete === 'function') {
        Promise.resolve()
          .then(() =>
            onSessionComplete({
              sessionId,
              session: {
                ...context,
                completedBatches: allBatchesForSession.map((b) => b.downstream_batch_id),
              },
              correlationId,
            })
          )
          .catch((err) => {
            logger.error('onSessionComplete hook failed', {
              operation: 'post-processing-hook-error',
              sessionId,
              correlationId,
              error: err.message,
              stack: err.stack,
            });
          });
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
            status: 'SYNCHRONOUS',
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
            status: 'SYNCHRONOUS',
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
          status: 'SYNCHRONOUS',
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

      await persistence.updateBatch(batchERC, { status: 'BYPASSED' });

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
