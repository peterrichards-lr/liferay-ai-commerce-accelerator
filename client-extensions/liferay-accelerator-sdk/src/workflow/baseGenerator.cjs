const BaseWorkflowService = require('./baseWorkflowService.cjs');
const { delay, createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX, ENV, WORKFLOW_STEPS } = require('../utils/constants.cjs');

/**
 * BaseGenerator - Specialized orchestrator for data generation workflows.
 * It manages the execution of registered steps and ensures correct sequencing
 * for synchronous, parallel, and asynchronous operations.
 */
class BaseGenerator extends BaseWorkflowService {
  constructor(ctx) {
    super(ctx);
    this.steps = {}; // Subclasses must define their step map
  }

  /**
   * Generalized entry point for generation workflows.
   */
  async runWorkflow(config, options, flowType, steps, totals) {
    const sessionId = options.sessionId || createERC(ERC_PREFIX.BATCH_SESSION);
    options.sessionId = sessionId;

    // Standardize selected languages
    if (
      !options.selectedLanguages ||
      (Array.isArray(options.selectedLanguages) &&
        options.selectedLanguages.length === 0)
    ) {
      const fallbackLanguage = config.defaultLanguageId || ENV.DEFAULT_LOCALE;
      this.logger.info(
        `No languages selected for generation. Falling back to: ${fallbackLanguage}`,
        { sessionId }
      );
      options.selectedLanguages = [fallbackLanguage];
    }

    await this.persistence.createSession({
      sessionId,
      flowType,
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: {
        config,
        options,
        steps,
        generator: flowType,
      },
    });

    this.progress.sessionStarted({
      sessionId,
      flowType,
      correlationId: config.correlationId,
      totalSteps: steps.length,
      totals,
    });

    // Check completion (in case session finished instantly)
    this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );

    this.logger.info(`${flowType} generation workflow started`, {
      sessionId,
      steps: steps.map((s) => s.name || s.type),
      correlationId: config.correlationId,
    });

    return {
      sessionId,
      message: `${flowType} generation workflow started.`,
    };
  }

  /**
   * Standard step to introduce a delay for Liferay search indexing to settle.
   */
  async _runInterServiceSyncDelayStep(
    sessionId,
    stepKey = WORKFLOW_STEPS.SYNC_DELAY
  ) {
    const session = await this.persistence.getSession(sessionId);
    const { correlationId } = session;

    const delayMs = ENV.LIFERAY_SYNC_DELAY_MS || 10000;

    this.logger.info(
      `Starting inter-service synchronization delay of ${delayMs}ms for step: ${stepKey}`,
      { sessionId, correlationId }
    );

    await delay(delayMs);

    await this.completeSyncStep(sessionId, stepKey);

    this.logger.info('Inter-service synchronization delay completed.', {
      sessionId,
      correlationId,
    });
  }

  /**
   * Adaptive Sync Delay with Exponential Backoff.
   * Waits for a condition to be met (e.g., products indexed) before proceeding.
   */
  async _runAdaptiveSyncDelayStep(sessionId, stepKey, checkFn) {
    const session = await this.persistence.getSession(sessionId);
    const { config, correlationId } = session;

    const resilience = this.ctx.config.getWorkflowResilienceConfigCached();
    const {
      initialDelayMs = 5000,
      maxRetries = 5,
      multiplier = 2,
    } = resilience;

    this.logger.info(`Starting adaptive sync delay for step: ${stepKey}`, {
      sessionId,
      correlationId,
      maxRetries,
    });

    let attempt = 0;
    let success = false;

    while (attempt < maxRetries) {
      if (attempt > 0) {
        const waitMs = initialDelayMs * Math.pow(multiplier, attempt - 1);
        this.logger.debug(
          `Retry ${attempt}/${maxRetries} for ${stepKey} in ${waitMs}ms...`,
          { sessionId, correlationId }
        );
        await delay(waitMs);
      }

      try {
        success = await checkFn(config, session.context);
        if (success) {
          this.logger.info(
            `Condition met for ${stepKey} on attempt ${attempt}`,
            {
              sessionId,
              correlationId,
            }
          );
          break;
        }
      } catch (err) {
        this.logger.warn(`Check failed for ${stepKey}: ${err.message}`, {
          sessionId,
          correlationId,
        });
      }
      attempt++;
    }

    if (!success) {
      this.logger.warn(
        `Adaptive sync delay for ${stepKey} finished without meeting condition. Proceeding anyway.`,
        { sessionId, correlationId }
      );
    }

    await this.completeSyncStep(
      sessionId,
      stepKey,
      'SYNCHRONOUS',
      success ? 1 : 0,
      1
    );
  }

  /**
   * Metadata Step: Load countries from Liferay.
   */
  async _runLoadCountriesStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config } = session.context;

    this.logger.info('Loading countries from Liferay...', { sessionId });

    const countries = await this.liferay.getCountries(config);

    await this.persistence.updateSessionContext(sessionId, {
      countries: countries.items || countries,
    });

    await this.completeSyncStep(sessionId, WORKFLOW_STEPS.LOAD_COUNTRIES);
  }

  /**
   * Metadata Step: Load active languages from Liferay.
   */
  async _runLoadLanguagesStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config } = session.context;

    this.logger.info('Loading active languages from Liferay...', { sessionId });

    const languages = await this.liferay.getLanguages(config);

    await this.persistence.updateSessionContext(sessionId, {
      languages: languages.items || languages,
    });

    await this.completeSyncStep(sessionId, WORKFLOW_STEPS.LOAD_LANGUAGES);
  }

  /**
   * Hardening: Programmatically verifies that all registered steps have
   * a corresponding method handler. Throws at startup if mapping is broken.
   */
  verifySteps() {
    for (const [stepName, handler] of Object.entries(this.steps)) {
      if (typeof handler !== 'function') {
        throw new Error(
          `FATAL: Workflow Step '${stepName}' in ${this.constructor.name} has no valid method handler.`
        );
      }
    }
  }

  /**
   * Orchestrates the execution of a single named step.
   */
  async executeStep(sessionId, stepName) {
    const session = await this.persistence.getSession(sessionId);
    if (!session) return;
    const { correlationId, flow_type: flowType } = session;

    const steps = session.context.steps || [];
    const stepConfig = steps.find((s) =>
      typeof s === 'string' ? s === stepName : s.name === stepName
    );
    const stepType = stepConfig?.type || 'sync';

    const stepHandler = this.steps[stepName];
    if (!stepHandler) {
      // Structural steps (parallel, sequence) don't have handlers; they are orchestrated in executeNextStep
      if (['parallel', 'sequence'].includes(stepType)) {
        return;
      }

      // HARDENING: Throw fatal error instead of silently bypassing.
      // This prevents "Ghost Steps" from causing downstream data corruption.
      throw new Error(
        `FATAL: No handler found for workflow step '${stepName}' in ${this.constructor.name}. Register it in the constructor steps map.`
      );
    }

    // State Gatekeeping: Verify dependencies
    const isReady = await this.verifyStepDependencies(
      sessionId,
      stepName,
      session.context.steps
    );
    if (!isReady) return;

    this.logger.info(`Executing step: ${stepName}`, {
      sessionId,
      correlationId,
    });

    // Emit step start via progress service
    this.progress.stepStarted({
      sessionId,
      step: stepName,
      entityType: this._normalizeEntityType(stepName),
      operation: flowType,
      correlationId,
    });

    try {
      const result = await stepHandler(sessionId, session);

      // HARDENING: Even if the handler returns, check if it created any FAILED batches
      // for this specific step. This catches swallowed errors.
      const updatedBatches =
        await this.persistence.getBatchesForSession(sessionId);
      const failedBatch = updatedBatches.find(
        (b) => b.step_key === stepName && b.status === 'FAILED'
      );

      if (failedBatch) {
        throw new Error(
          `Step '${stepName}' handler completed but produced a FAILED batch.`
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Error in step handler '${stepName}': ${error.message}`,
        {
          sessionId,
          correlationId,
          stack: error.stack,
        }
      );
      throw error;
    }
  }

  /**
   * Hardening: Standardized method to mark a synchronous step as complete.
   * This creates a physical database entry and triggers the workflow advancement.
   */
  async completeSyncStep(
    sessionId,
    stepKey,
    status = 'SYNCHRONOUS',
    processedCount = 1,
    totalCount = 1
  ) {
    const session = await this.persistence.getSession(sessionId);
    if (!session) return;

    // 1. Persist the completion state to the database
    await this.persistence.createBatch({
      erc: `SYNC-${stepKey}-${Date.now()}`,
      sessionId,
      stepKey,
      status,
      processed_count: processedCount,
      total_count: totalCount,
    });

    this.logger.debug(
      `Synchronous step '${stepKey}' marked as ${status}. Advancing...`,
      { sessionId }
    );

    // Broadcast step completion to the UI
    if (this.progress && typeof this.progress.stepCompleted === 'function') {
      await this.progress.stepCompleted({
        sessionId,
        step: stepKey,
        entityType: this._normalizeEntityType(stepKey),
        operation: session.flow_type || session.flowType,
        totalCount,
        correlationId: session.correlationId,
      });
    }

    // 2. Trigger the next step discovery
    // We add a tiny jitter to ensure the SQLite write-lock has cleared
    await delay(100);
    return true;
  }

  /**
   * Standardized callback handler for post-batch logic.
   * Can be overridden by subclasses.
   */
  async handleBatchCallback(_sessionId, _batchERC) {
    return true;
  }

  /**
   * Recursively removes forbidden numeric IDs from a payload.
   * Liferay expects only ERCs for new items in a batch.
   */
  deepClean(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepClean(item));
    }

    const cleaned = { ...obj };
    const forbidden = ['id', 'productId', 'accountId', 'skuId'];

    for (const key of forbidden) {
      delete cleaned[key];
    }

    // Recurse into nested objects
    for (const key in cleaned) {
      if (typeof cleaned[key] === 'object') {
        cleaned[key] = this.deepClean(cleaned[key]);
      }
    }

    return cleaned;
  }

  /**
   * Identifies and executes the next logical step(s) in the workflow.
   * Loops automatically through consecutive synchronous steps to avoid stalls.
   */
  async executeNextStep(sessionId) {
    let continueAdvancing = true;
    this.logger.debug(`Advancing workflow for session ${sessionId}...`);

    while (continueAdvancing) {
      let currentCorrelationId = '∅';
      try {
        const session = await this.persistence.getSession(sessionId);
        if (
          !session ||
          ['COMPLETED', 'FAILED', 'CANCELLED'].includes(session.status)
        ) {
          break;
        }

        const { correlationId, context } = session;
        currentCorrelationId = correlationId;
        const workflowSteps = context.steps || [];
        const batches = await this.persistence.getBatchesForSession(sessionId);

        const isTerminal = (b) =>
          ['COMPLETED', 'FAILED', 'BYPASSED', 'SYNCHRONOUS'].includes(b.status);

        const stepStateMap = new Map();
        const allStepKeys = [...new Set(batches.map((b) => b.step_key))];

        for (const key of allStepKeys) {
          const stepBatches = batches.filter((b) => b.step_key === key);
          if (stepBatches.some((b) => b.status === 'FAILED')) {
            stepStateMap.set(key, 'FAILED');
          } else if (stepBatches.every(isTerminal)) {
            stepStateMap.set(key, 'COMPLETE');
          } else {
            stepStateMap.set(key, 'RUNNING');
          }
        }

        const getStepState = (s) => {
          const name = typeof s === 'string' ? s : s.name;
          const type = s.type || 'sync';

          if (type === 'parallel') {
            const subStates = s.steps.map(getStepState);
            if (subStates.some((st) => st === 'FAILED')) return 'FAILED';
            if (subStates.every((st) => st === 'COMPLETE')) return 'COMPLETE';
            if (subStates.some((st) => st === 'RUNNING' || st === 'COMPLETE'))
              return 'RUNNING';
            return 'PENDING';
          }

          if (type === 'sequence') {
            const subStates = s.steps.map(getStepState);
            if (subStates.some((st) => st === 'FAILED')) return 'FAILED';
            if (subStates.every((st) => st === 'COMPLETE')) return 'COMPLETE';
            if (subStates.some((st) => st === 'RUNNING' || st === 'COMPLETE'))
              return 'RUNNING';
            return 'PENDING';
          }

          return stepStateMap.get(name) || 'PENDING';
        };

        const newActiveSteps = [];
        let foundBlockingStep = false;
        let executedAnySyncStep = false;

        const processStep = async (step) => {
          const stepName = typeof step === 'string' ? step : step.name;
          const stepType = step.type || 'sync';
          const state = getStepState(step);

          if (state === 'FAILED') {
            const displayId = stepName || stepType;
            // ENHANCED OBSERVABILITY: Find the specific failed sub-step
            let failedSubStep = '';
            if (['parallel', 'sequence'].includes(stepType)) {
              const failedSteps = step.steps.filter(
                (s) => getStepState(s) === 'FAILED'
              );
              failedSubStep =
                failedSteps.length > 0
                  ? ` (Failed sub-steps: ${failedSteps.map((s) => s.name || 'unnamed').join(', ')})`
                  : '';
            }

            if (
              session.flowType === 'delete' ||
              session.flow_type === 'delete'
            ) {
              this.logger.warn(
                `Workflow step '${displayId}' failed${failedSubStep}. Try-Every-Step mode active for deletion. Continuing to next step...`,
                {
                  sessionId,
                  correlationId,
                  step: stepName,
                  type: stepType,
                }
              );
              return true; // Treat as complete to unblock subsequent cleanup steps
            }

            this.logger.error(
              `Workflow step '${displayId}' failed${failedSubStep}. Stopping advancement.`,
              {
                sessionId,
                correlationId,
                step: stepName,
                type: stepType,
                state: 'FAILED',
              }
            );
            await this._finalizeSession(sessionId, correlationId);
            foundBlockingStep = true;
            return false;
          }

          if (state === 'COMPLETE') return true;

          if (stepType === 'parallel') {
            await Promise.all(
              step.steps.map((subStep) => processStep(subStep))
            );

            const subStates = step.steps.map(getStepState);

            // If any sub-step is still running or pending, we are NOT terminal
            if (subStates.some((st) => ['RUNNING', 'PENDING'].includes(st))) {
              foundBlockingStep = true;
              return false;
            }

            // All sub-steps are terminal (COMPLETE or FAILED)
            if (subStates.some((st) => st === 'FAILED')) {
              // HARDENING: We allow continuation if it's a parallel block,
              // but we mark the block itself as finished so the master sequence can move on.
              // This ensures that a failure in 'Products' doesn't prevent 'Account Defaults' from running.
              this.logger.warn(
                `Parallel step '${stepName || 'unnamed'}' finished with some sub-step failures. Continuing to next top-level step...`,
                { sessionId }
              );
              return true;
            }

            return true; // All sub-steps completed successfully
          } else if (stepType === 'sequence') {
            for (const subStep of step.steps) {
              const subState = await processStep(subStep);
              if (!subState) {
                foundBlockingStep = true;
                return false;
              }
            }
            return true;
          } else if (stepType === 'async') {
            if (state === 'PENDING') {
              await this.executeStep(sessionId, stepName);
            }
            return true;
          } else {
            if (state === 'PENDING') {
              newActiveSteps.push(stepName);
              await this.persistence.updateSessionCurrentSteps(
                sessionId,
                newActiveSteps
              );

              // HARDENING: If we are part of a coordinated flow, delegate execution
              // to the coordinator so it can route the step to the correct generator.
              // Otherwise, we might throw a FATAL ERROR if the step belongs to another generator.
              if (
                this.ctx.workflowCoordinator &&
                this.constructor.name !== 'WorkflowCoordinator'
              ) {
                await this.ctx.workflowCoordinator.executeStep(
                  sessionId,
                  stepName
                );
              } else {
                await this.executeStep(sessionId, stepName);
              }
              executedAnySyncStep = true;
            } else {
              newActiveSteps.push(stepName);
            }
            foundBlockingStep = true;
            return false;
          }
        };

        for (const step of workflowSteps) {
          const ok = await processStep(step);
          if (!ok) break;
        }

        if (!foundBlockingStep) {
          const allDone = workflowSteps.every(
            (s) => getStepState(s) === 'COMPLETE'
          );
          if (allDone) {
            await this._finalizeSession(sessionId, correlationId);
          }
          continueAdvancing = false;
        }

        if (executedAnySyncStep) {
          // If we ran a sync step, check if it finished immediately (like a delay or purely internal logic)
          // If so, loop again. If not, wait for callback.
          const freshBatches =
            await this.persistence.getBatchesForSession(sessionId);
          const activeBatches = freshBatches.filter(
            (b) => newActiveSteps.includes(b.step_key) && !isTerminal(b)
          );
          if (activeBatches.length > 0) {
            continueAdvancing = false;
          }
        } else {
          continueAdvancing = false;
        }

        await this.persistence.updateSessionCurrentSteps(
          sessionId,
          newActiveSteps
        );
      } catch (err) {
        const errorReference =
          err.errorReferenceCode || err.errorReference || null;
        this.logger.error(
          `Fatal error in executeNextStep for session ${sessionId}: ${err.message}`,
          {
            sessionId,
            stack: err.stack,
            errorReference,
          }
        );

        // HARDENING: Persist the failure in the database so hydration works correctly
        await this.persistence.tryFailSession(
          sessionId,
          err.message,
          errorReference,
          err.stack
        );

        // Notify frontend of the failure so it doesn't hang in "Generating..." state
        await this.progress.sessionFailed({
          sessionId,
          error: err,
          correlationId: currentCorrelationId,
          errorReference,
          errorStack: err.stack,
        });

        continueAdvancing = false;
      }
    }
  }

  async _finalizeSession(sessionId, correlationId) {
    const batches = await this.persistence.getBatchesForSession(sessionId);

    const failedBatch = batches.find((b) => b.status === 'FAILED');
    if (failedBatch) {
      let errorMsg = `Workflow failed at step: ${failedBatch.step_key}`;

      if (failedBatch.error_message) {
        errorMsg += ` - Error: ${failedBatch.error_message}`;
      } else if (failedBatch.error_count > 0) {
        errorMsg += ` (${failedBatch.error_count} items failed)`;
      } else if (failedBatch.processed_count < failedBatch.total_count) {
        errorMsg += ` (Incomplete batch: processed ${failedBatch.processed_count} of ${failedBatch.total_count})`;
      }

      const errorReference =
        failedBatch.error_reference_code || failedBatch.erc || null;

      if (
        await this.persistence.tryFailSession(
          sessionId,
          errorMsg,
          errorReference
        )
      ) {
        await this.progress.sessionFailed({
          sessionId,
          correlationId,
          error: {
            message: errorMsg,
          },
          errorReference,
        });
      }
      return;
    }

    if (await this.persistence.tryFinalizeSession(sessionId)) {
      this.logger.info(`Workflow session completed: ${sessionId}`, {
        correlationId,
      });
      await this.progress.sessionCompleted({ sessionId, correlationId });

      if (typeof this.onSessionComplete === 'function') {
        const session = await this.persistence.getSession(sessionId);
        this.onSessionComplete({ sessionId, correlationId, session });
      }
    }
  }
}

module.exports = BaseGenerator;
