const { createERC } = require('../../utils/misc.cjs');
const { ERC_PREFIX } = require('../../utils/constants.cjs');
const { asItems, asCount } = require('../../utils/liferayUtils.cjs');

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

  _normalizeEntityType(stepKey) {
    const map = {
      'product-data-generation': 'products',
      products: 'products',
      'resolve-product-ids': 'products',
      'product-skus': 'products',
      'link-product-options': 'options',
      'attach-images': 'images',
      'process-images': 'images',
      'attach-pdfs': 'pdfs',
      'process-pdfs': 'pdfs',
      'update-inventory': 'products',
      inventory: 'products',
      'generate-warehouses': 'warehouses',
      'resolve-warehouse-ids': 'warehouses',
      accounts: 'accounts',
      'postal-addresses': 'accounts',
      orders: 'orders',
      deleteProducts: 'products',
      deleteAccounts: 'accounts',
      deleteOrders: 'orders',
      deleteWarehouses: 'warehouses',
      deleteWarehouseItems: 'warehouses',
      deleteSpecifications: 'specifications',
      deleteProductSpecifications: 'specifications',
      deleteOptions: 'options',
      deleteProductOptions: 'options',
      deletePriceLists: 'price-lists',
      deletePromotions: 'promotions',
    };

    return map[stepKey] || stepKey;
  }

  async _checkSessionCompletion(sessionId, correlationId) {
    const { logger, persistence } = this.ctx;
    
    let session = await persistence.getSession(sessionId);
    if (!session || session.status === 'COMPLETED' || session.status === 'FAILED') {
      return;
    }

    let continueLoop = true;
    while (continueLoop) {
      // Refresh session data at the start of each iteration to avoid stale state
      session = await persistence.getSession(sessionId);
      if (!session) break;

      const allBatchesForSession = await persistence.getBatchesForSession(sessionId);
      
      // Use the steps currently tracked in the session object
      const { activeSteps, hasFailures } = await this._updateActiveSteps(
        session,
        session.currentSteps, 
        allBatchesForSession,
        correlationId
      );

      if (hasFailures) {
        const failed = await persistence.tryFailSession(sessionId);
        if (failed) {
          this.ctx.progress.sessionFailed({
            sessionId,
            error: { message: 'Workflow failed during step execution.' },
            correlationId,
          });
        }
        return;
      }
      
      let currentSteps = activeSteps;
      
      if (currentSteps.length === 0) {
        const { newActiveSteps, startedAny } = await this._advanceWorkflow(session, allBatchesForSession, correlationId);
        
        if (!startedAny || newActiveSteps.length === 0) {
          await persistence.updateSessionCurrentSteps(sessionId, []);
          continueLoop = false;
        } else {
          // Check if all newly started steps are already terminal (synchronous/bypassed)
          const latestBatches = await persistence.getBatchesForSession(sessionId);
          const { activeSteps: stillActive, hasFailures: newFailures } = await this._updateActiveSteps(
            session, 
            newActiveSteps, 
            latestBatches, 
            correlationId
          );

          if (newFailures) {
            const failed = await persistence.tryFailSession(sessionId);
            if (failed) {
              this.ctx.progress.sessionFailed({
                sessionId,
                error: { message: 'Workflow failed during step execution.' },
                correlationId,
              });
            }
            return;
          }

          // Important: Update DB with the filtered active steps so the next iteration 
          // or next check doesn't re-detect terminal steps we just logged.
          await persistence.updateSessionCurrentSteps(sessionId, stillActive);
          
          if (stillActive.length === 0) {
            // All new steps are terminal, continue loop to advance again
            continue; 
          } else {
            // Some steps are still running, wait for callbacks
            continueLoop = false;
          }
        }
      } else {
        await persistence.updateSessionCurrentSteps(sessionId, currentSteps);
        continueLoop = false;
      }
      
      const latestBatches = await persistence.getBatchesForSession(sessionId);
      const workflowFinished = await this._isWorkflowFinished(session, currentSteps, latestBatches);

      if (workflowFinished) {
        await this._finalizeSession(session, latestBatches, correlationId);
        continueLoop = false;
      }
    }
  }

  async _updateActiveSteps(session, stepsToCheck, allBatchesForSession, correlationId) {
    const { logger, progress } = this.ctx;
    const sessionId = session.session_id;

    let hasFailures = false;
    const nextActiveSteps = [];

    if (!stepsToCheck || !Array.isArray(stepsToCheck)) return { activeSteps: [], hasFailures: false };

    for (const stepDefinition of stepsToCheck) {
      const stepName = typeof stepDefinition === 'string' ? stepDefinition : stepDefinition.name;
      const stepType = typeof stepDefinition === 'object' ? stepDefinition.type : 'sync';

      const batchesForStep = allBatchesForSession.filter(b => b.step_key === stepName);
      
      // A step is active if it has no terminal batches or if it's still running
      const isStepCompleted = batchesForStep.length > 0 && batchesForStep.every(b => this._isBatchTerminal(b));
      const isStepFailed = batchesForStep.some(b => b.status === 'FAILED');

      if (isStepFailed) {
        logger.error(`Step '${stepName}' failed.`, { sessionId, stepName });
        hasFailures = true;
        break; 
      }

      if (isStepCompleted) {
        logger.info(`Step '${stepName}' completed.`, { sessionId, stepName, stepType });
        
        // Emit step completion
        const totalCount = batchesForStep.reduce((sum, b) => sum + (b.total_count || 0), 0);
        progress.stepCompleted({
          sessionId,
          step: stepName,
          entityType: this._normalizeEntityType(stepName),
          operation: session.flow_type,
          totalCount,
          correlationId,
        });
      } else {
        nextActiveSteps.push(stepDefinition);
      }
    }

    return { activeSteps: nextActiveSteps, hasFailures };
  }

  _areAllStepsComplete(steps, completedStepNames) {
    return steps.every(s => {
      const name = typeof s === 'string' ? s : s.name;
      return completedStepNames.has(name);
    });
  }

  async _advanceWorkflow(session, allBatchesForSession, correlationId) {
    const { logger } = this.ctx;
    const { session_id: sessionId, context: { config, steps: workflowSteps } } = session;
    
    const newActiveSteps = [];
    let startedAny = false;

    const completedStepNames = new Set(allBatchesForSession.filter(b => this._isBatchTerminal(b)).map(b => b.step_key));
    const runningStepNames = new Set(allBatchesForSession.filter(b => !this._isBatchTerminal(b)).map(b => b.step_key));

    for (const step of workflowSteps) {
      const stepName = typeof step === 'string' ? step : step.name;
      const stepType = typeof step === 'object' ? step.type : 'sync';
      
      if (stepType === 'parallel') {
        if (this._areAllStepsComplete(step.steps, completedStepNames)) {
          continue;
        }

        let allSubStepsStartedOrRunning = true;
        for (const subStep of step.steps) {
          const subStepName = typeof subStep === 'string' ? subStep : subStep.name;
          if (!completedStepNames.has(subStepName) && !runningStepNames.has(subStepName)) {
            logger.info(`Starting parallel sub-step '${subStepName}'`, { sessionId, subStepName });
            newActiveSteps.push(subStep);
            await this._startStep(subStep, sessionId, config, correlationId);
            startedAny = true;
          } else if (runningStepNames.has(subStepName)) {
            newActiveSteps.push(subStep);
          } else {
            // This sub-step is completed
          }
        }
        
        // A parallel step blocks the main loop until all its sub-steps are terminal
        return { newActiveSteps, startedAny };
      }
      else if (stepType === 'async') {
        if (!completedStepNames.has(stepName) && !runningStepNames.has(stepName)) {
          logger.info(`Starting async step '${stepName}'`, { sessionId, stepName });
          // Async steps don't block, so we start them and continue the loop
          await this._startStep(step, sessionId, config, correlationId);
          startedAny = true;
          continue; 
        } else if (runningStepNames.has(stepName)) {
          // If it's still running, we don't add it to newActiveSteps (it's background)
          // and we continue to the next step
          continue;
        } else {
          // Already completed
          continue;
        }
      }
      else { // sync
        if (!completedStepNames.has(stepName) && !runningStepNames.has(stepName)) {
          logger.info(`Starting step '${stepName}'`, { sessionId, nextStepName: stepName });
          newActiveSteps.push(step);
          await this._startStep(step, sessionId, config, correlationId);
          return { newActiveSteps, startedAny: true };
        } else if (runningStepNames.has(stepName)) {
          newActiveSteps.push(step);
          return { newActiveSteps, startedAny: false };
        }
      }
    }

    return { newActiveSteps, startedAny };
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
      const { logger, persistence, progress } = this.ctx;
      const { session_id:sessionId, flow_type, context } = session;

      // Check for any failures across the entire session before completing
      const hasAnyFailures = allBatchesForSession.some(b => b.status === 'FAILED');
      if (hasAnyFailures) {
        const failed = await persistence.tryFailSession(sessionId);
        if (failed) {
          logger.error('Session failed due to batch processing errors detected during finalization', { sessionId });
          progress.sessionFailed({
            sessionId,
            error: { message: 'One or more steps failed during the workflow.' },
            correlationId,
          });
        }
        return;
      }

      // Atomic transition to COMPLETED
      const success = await persistence.tryFinalizeSession(sessionId);
      if (!success) {
        logger.debug('Session already terminal, skipping redundant finalization.', { sessionId });
        return;
      }

      logger.info('Workflow session completed - all steps finished', {
        operation: 'session-complete',
        correlationId,
        sessionId,
        flowType: flow_type,
        totalBatches: allBatchesForSession.length,
      });

      progress.sessionCompleted({
        sessionId,
        correlationId,
      });

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
      progress,
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

    // Emit step start
    progress.stepStarted({
      sessionId,
      step: stepName,
      entityType: this._normalizeEntityType(stepName),
      operation: flowType,
      correlationId,
    });

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
          totalCount: 0,
          processedCount: 0,
        });
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
      progress.sessionFailed({ sessionId, error, correlationId });
    }
  }


  async _runStep(step, { sessionId, config, options, channelId, catalogId }) {
    const { logger, liferay, persistence, progress } = this.ctx;

    const batchERC = createERC(ERC_PREFIX.BATCH_DELETION);

    await persistence.createBatch({
      erc: batchERC,
      sessionId,
      step_key: step,
      status: 'PREPARED',
    });

    const { hasItems, totalCount } = await this._checkIfEntitiesExist(
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

      await persistence.updateBatch(batchERC, { status: 'BYPASSED', totalCount: 0, processedCount: 0 });
      return;
    }

    const handler = BATCH_STEP_HANDLERS[step];

    if (handler) {
      const handlerContext = {
        config,
        options,
        batchERC,
        sessionId,
        channelId,
        catalogId,
        totalCount,
      };

      const result = await handler(this.ctx, handlerContext);

      if (result && result.batchRefs && result.batchRefs.length > 0) {
        // Native batches were triggered
        await persistence.updateBatch(batchERC, {
          status: 'SUBMITTED',
          downstreamBatchId: result.batchRefs[0].taskId,
          totalCount: totalCount,
        });
        
        progress.batchStarted({
          sessionId,
          batchERC,
          batchId: result.batchRefs[0].taskId,
          totalItems: totalCount,
          entityType: this._normalizeEntityType(step),
          operation: 'delete',
          correlationId: config.correlationId,
        });
      } else if (result && result.success) {
        // Simulated or empty step completed
        await persistence.updateBatch(batchERC, {
          status: 'COMPLETED',
          totalCount: totalCount,
          processedCount: totalCount,
        });
      } else {
        // Fallback for handlers that don't return standardized results
        await persistence.updateBatch(batchERC, {
          status: 'COMPLETED',
          totalCount: totalCount,
          processedCount: totalCount,
        });
      }
    } else {
      logger.warn(`Unknown step in deletion process: ${step}`, {
        batchERC,
      });

      await persistence.updateBatch(batchERC, { status: 'FAILED' });
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
        // Use search instead of invalid sw filter for Accounts
        const res = await liferay.getAccounts(config, {
          channelId,
          pageSize: 1,
          search: 'AICA-ACC',
        });
        return {
          totalCount: res.totalCount,
        };
      },
      deleteProducts: async () => {
        const res = await liferay.getProducts(config, {
          catalogId,
          pageSize: 1,
        });
        return {
          totalCount: res.totalCount,
        };
      },
      deleteProductOptions: async () => {
        const res = await liferay.getProducts(config, {
          catalogId,
          pageSize: 1,
        });
        return {
          totalCount: res.totalCount,
        };
      },
      deleteProductSpecifications: async () => {
        const res = await liferay.getProducts(config, {
          catalogId,
          pageSize: 1,
        });
        return {
          totalCount: res.totalCount,
        };
      },
      deleteSpecifications: async () => {
        const res = await liferay.getSpecifications(config, { pageSize: 1 });
        return {
          totalCount: res.totalCount,
        };
      },
      deleteOptions: async () => {
        const res = await liferay.getOptions(config, { pageSize: 1 });
        return {
          totalCount: res.totalCount,
        };
      },
      deleteOptionCategories: async () => {
        const res = await liferay.getOptionCategories(config, {
          pageSize: 1,
        });
        return {
          totalCount: res.totalCount,
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
        const res = await liferay.getOrders(config, {
          pageSize: 1,
        });
        return {
          totalCount: res.totalCount,
        };
      },
      deleteWarehouses: async () => {
        const res = await liferay.getWarehouses(config, { pageSize: 1 });
        return {
          totalCount: res.totalCount,
        };
      },
      deleteWarehouseItems: async () => {
        const res = await liferay.getWarehouseItems(config, { pageSize: 1, search: 'AICA-INV' });
        return {
          totalCount: res.totalCount,
        };
      },
      deletePriceLists: async () => {
        const res = await liferay.getPriceLists(config, { pageSize: 1 });
        return {
          totalCount: res.totalCount,
        };
      },
      deletePromotions: async () => {
        const res = await liferay.getPromotions(config, { pageSize: 1 });
        return {
          totalCount: res.totalCount,
        };
      },
    };

    if (!checkMap[entityType]) return { hasItems: false }; 

    const result = await checkMap[entityType]();
    const totalCount = result.totalCount || 0;
    const hasItems = totalCount > 0 || !!result.hasItems;

    logger.debug('Entity existence check result', {
      entityType,
      hasItems,
      totalCount,
    });

    return { hasItems, totalCount };
  }

  _getOnSessionComplete(flowType) {
    const { productGenerator, accountGenerator, orderGenerator } = this.ctx;
    const generatorMap = {
      generate: productGenerator,
      accounts: accountGenerator,
      orders: orderGenerator,
    };
    const generator = generatorMap[flowType];
    return generator?.onSessionComplete?.bind(generator);
  }

  async processCallback(batchERC, payload) {
    const { logger, liferay, persistence, progress } = this.ctx;

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
      
      logger.debug('Import task details retrieved', {
        batchId,
        sessionId: dbBatch.session_id,
        importTask: importTask?.data || importTask
      });

      const { 
        processedItemsCount = 0, 
        totalItemsCount = 0, 
        failedItems = [] 
      } = importTask?.data || {}; 
      const errorCount = failedItems?.length || 0;

      let failureDetails = [];
      if (errorCount > 0) {
        try {
          failureDetails = await liferay.getImportTaskFailedItemReport(config, batchId) || [];
          logger.error('Batch processing errors detected', {
            batchId,
            batchERC,
            sessionId: dbBatch.session_id,
            errorCount,
            failureDetails: failureDetails.slice(0, 10), // Log first 10 for visibility
          });
        } catch (reportError) {
          logger.warn('Failed to retrieve detailed batch failure report', {
            batchId,
            error: reportError.message,
          });
        }
      }

      await persistence.updateBatch(batchERC, {
        status: status.toUpperCase(),
        processedCount: processedItemsCount,
        totalCount: totalItemsCount,
        errorCount: errorCount,
        downstreamBatchId: batchId,
      });

      progress.batchCompleted(
        {
          entityType: this._normalizeEntityType(dbBatch.step_key),
          operation: session.flow_type,
          batchId: batchId,
          batchERC: batchERC,
          sessionId: dbBatch.session_id,
          successCount: processedItemsCount,
          failureCount: errorCount,
          errors: (failureDetails && failureDetails.length > 0) ? failureDetails.slice(0, 5) : (failedItems ? failedItems.slice(0, 5) : []),
          correlationId,
        }
      );

      await this._checkSessionCompletion(dbBatch.session_id, correlationId);
    } catch (error) {      logger.error('Error processing batch callback', {
        operation: 'batch-callback-error',
        batchERC,
        correlationId,
        message: error.message,
      });

      await persistence.updateBatch(batchERC, { status: 'FAILED' });
      progress.batchFailed({
        sessionId: dbBatch.session_id,
        batchERC,
        batchId,
        error,
        entityType: this._normalizeEntityType(dbBatch.step_key),
        operation: session.flow_type,
        correlationId,
      });
    }
  }
}

module.exports = BatchCallbackService;
