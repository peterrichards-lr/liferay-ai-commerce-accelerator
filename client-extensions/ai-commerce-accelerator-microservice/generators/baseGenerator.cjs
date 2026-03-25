const BaseWorkflowService = require('../services/baseWorkflowService.cjs');
const { delay } = require('../utils/misc.cjs');

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
   * Orchestrates the execution of a single named step.
   */
  async executeStep(sessionId, stepName) {
    const session = await this.persistence.getSession(sessionId);
    if (!session) return;
    const { correlationId, flow_type: flowType } = session;

    const stepHandler = this.steps[stepName];
    if (!stepHandler) {
      this.logger.warn(`No handler found for step '${stepName}' in ${this.constructor.name}`, { sessionId, correlationId });
      return await this.completeSyncStep(sessionId, stepName, 'SYNCHRONOUS');
    }

    // State Gatekeeping: Verify dependencies
    const isReady = await this.verifyStepDependencies(sessionId, stepName, session.context.steps);
    if (!isReady) return;

    this.logger.info(`Executing step: ${stepName}`, { sessionId, correlationId });

    // Emit step start via progress service
    this.progress.stepStarted({
      sessionId,
      step: stepName,
      entityType: this._normalizeEntityType(stepName),
      operation: flowType,
      correlationId
    });

    try {
      return await stepHandler(sessionId, session);
    } catch (error) {
      this.logger.error(`Error in step handler '${stepName}': ${error.message}`, {
        sessionId,
        correlationId,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Standardized callback handler for post-batch logic.
   * Can be overridden by subclasses.
   */
  async handleBatchCallback(sessionId, batchERC) {
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
      try {
        const session = await this.persistence.getSession(sessionId);
        if (!session || session.status === 'COMPLETED' || session.status === 'FAILED') {
          break;
        }

        const { correlationId, context } = session;
        const workflowSteps = context.steps || [];
        const batches = await this.persistence.getBatchesForSession(sessionId);

        const isTerminal = (b) => ['COMPLETED', 'FAILED', 'BYPASSED', 'SYNCHRONOUS'].includes(b.status);
        
        const stepStateMap = new Map();
        const allStepKeys = [...new Set(batches.map(b => b.step_key))];
        
        for (const key of allStepKeys) {
          const stepBatches = batches.filter(b => b.step_key === key);
          if (stepBatches.some(b => b.status === 'FAILED')) {
            stepStateMap.set(key, 'FAILED');
          } else if (stepBatches.every(isTerminal)) {
            stepStateMap.set(key, 'COMPLETE');
          } else {
            stepStateMap.set(key, 'RUNNING');
          }
        }

        const getStepState = (s) => {
          const name = typeof s === 'string' ? s : s.name;
          if (s.type === 'parallel') {
            const subStates = s.steps.map(getStepState);
            if (subStates.some(st => st === 'FAILED')) return 'FAILED';
            if (subStates.every(st => st === 'COMPLETE')) return 'COMPLETE';
            if (subStates.some(st => st === 'RUNNING' || st === 'COMPLETE')) return 'RUNNING';
            return 'PENDING';
          }
          return stepStateMap.get(name) || 'PENDING';
        };

        const newActiveSteps = [];
        let foundBlockingStep = false;
        let executedAnySyncStep = false;

        for (const step of workflowSteps) {
          const stepName = typeof step === 'string' ? step : step.name;
          const stepType = step.type || 'sync';
          const state = getStepState(step);

          if (state === 'FAILED') {
            this.logger.error(`Workflow step '${stepName}' failed. Stopping advancement.`, { sessionId, correlationId });
            await this._finalizeSession(sessionId, correlationId);
            continueAdvancing = false;
            foundBlockingStep = true;
            break;
          }

          if (state === 'COMPLETE') continue;

          if (stepType === 'parallel') {
            for (const subStep of step.steps) {
              const subName = typeof subStep === 'string' ? subStep : subStep.name;
              const subState = getStepState(subStep);
              if (subState === 'PENDING') {
                newActiveSteps.push(subName);
                await this.executeStep(sessionId, subName);
              } else if (subState === 'RUNNING') {
                newActiveSteps.push(subName);
              }
            }
            foundBlockingStep = true;
            continueAdvancing = false;
            break;
          } else if (stepType === 'async') {
            if (state === 'PENDING') {
              await this.executeStep(sessionId, stepName);
            }
            continue;
          } else {
            if (state === 'PENDING') {
              newActiveSteps.push(stepName);
              await this.persistence.updateSessionCurrentSteps(sessionId, newActiveSteps);
              await this.executeStep(sessionId, stepName);
              executedAnySyncStep = true;
            } else {
              newActiveSteps.push(stepName);
              continueAdvancing = false;
            }
            foundBlockingStep = true;
            break;
          }
        }

        if (!foundBlockingStep) {
          const allDone = workflowSteps.every(s => getStepState(s) === 'COMPLETE');
          if (allDone) {
            await this._finalizeSession(sessionId, correlationId);
          }
          continueAdvancing = false;
        }

        if (!executedAnySyncStep) {
          continueAdvancing = false;
        }

        await this.persistence.updateSessionCurrentSteps(sessionId, newActiveSteps);
      } catch (err) {
        this.logger.error(`Fatal error in executeNextStep for session ${sessionId}: ${err.message}`, {
          sessionId,
          stack: err.stack
        });
        continueAdvancing = false;
      }
    }
  }

  async _finalizeSession(sessionId, correlationId) {
    const batches = await this.persistence.getBatchesForSession(sessionId);

    const hasFailures = batches.some(b => b.status === 'FAILED');
    if (hasFailures) {
      if (await this.persistence.tryFailSession(sessionId)) {
        this.progress.sessionFailed({ sessionId, correlationId, error: { message: 'Workflow failed.' } });
      }
      return;
    }

    if (await this.persistence.tryFinalizeSession(sessionId)) {
      this.logger.info(`Workflow session completed: ${sessionId}`, { correlationId });
      this.progress.sessionCompleted({ sessionId, correlationId });

      if (typeof this.onSessionComplete === 'function') {
        const session = await this.persistence.getSession(sessionId);
        this.onSessionComplete({ sessionId, correlationId, session });
      }
    }
  }
}

module.exports = BaseGenerator;
