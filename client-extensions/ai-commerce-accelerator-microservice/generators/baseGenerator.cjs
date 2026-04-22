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

    const stepConfig = session.context.steps.find((s) =>
      typeof s === 'string' ? s === stepName : s.name === stepName
    );
    const stepType = stepConfig?.type || 'sync';

    const stepHandler = this.steps[stepName];
    if (!stepHandler) {
      // Structural steps (parallel, sequence) don't have handlers; they are orchestrated in executeNextStep
      if (['parallel', 'sequence'].includes(stepType)) {
        return;
      }

      this.logger.warn(
        `No handler found for step '${stepName}' in ${this.constructor.name}`,
        { sessionId, correlationId }
      );
      return await this.completeSyncStep(sessionId, stepName, 'SYNCHRONOUS');
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
      return await stepHandler(sessionId, session);
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
        if (
          !session ||
          session.status === 'COMPLETED' ||
          session.status === 'FAILED'
        ) {
          break;
        }

        const { correlationId, context } = session;
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
            this.logger.error(
              `Workflow step '${stepName || stepType}' failed. Stopping advancement.`,
              { sessionId, correlationId }
            );
            await this._finalizeSession(sessionId, correlationId);
            foundBlockingStep = true;
            return false;
          }

          if (state === 'COMPLETE') return true;

          if (stepType === 'parallel') {
            for (const subStep of step.steps) {
              await processStep(subStep);
            }
            foundBlockingStep = true;
            return false;
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
              await this.executeStep(sessionId, stepName);
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
        this.logger.error(
          `Fatal error in executeNextStep for session ${sessionId}: ${err.message}`,
          {
            sessionId,
            stack: err.stack,
          }
        );
        continueAdvancing = false;
      }
    }
  }

  async _finalizeSession(sessionId, correlationId) {
    const batches = await this.persistence.getBatchesForSession(sessionId);

    const hasFailures = batches.some((b) => b.status === 'FAILED');
    if (hasFailures) {
      if (await this.persistence.tryFailSession(sessionId)) {
        this.progress.sessionFailed({
          sessionId,
          correlationId,
          error: { message: 'Workflow failed.' },
        });
      }
      return;
    }

    if (await this.persistence.tryFinalizeSession(sessionId)) {
      this.logger.info(`Workflow session completed: ${sessionId}`, {
        correlationId,
      });
      this.progress.sessionCompleted({ sessionId, correlationId });

      if (typeof this.onSessionComplete === 'function') {
        const session = await this.persistence.getSession(sessionId);
        this.onSessionComplete({ sessionId, correlationId, session });
      }
    }
  }
}

module.exports = BaseGenerator;
