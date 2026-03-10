const BaseWorkflowService = require('../services/baseWorkflowService.cjs');

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

    return await stepHandler(sessionId, session);
  }

  /**
   * Standardized callback handler for post-batch logic.
   * Can be overridden by subclasses.
   */
  async handleBatchCallback(sessionId, batchERC) {
    return true;
  }

  /**
   * Identifies and executes the next logical step(s) in the workflow.
   */
  async executeNextStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    if (!session || session.status === 'COMPLETED' || session.status === 'FAILED') return;

    const { correlationId, context } = session;
    const workflowSteps = context.steps || [];
    const batches = await this.persistence.getBatchesForSession(sessionId);

    const isTerminal = (b) => ['COMPLETED', 'FAILED', 'BYPASSED', 'SYNCHRONOUS'].includes(b.status);
    
    const stepCompletionMap = new Map();
    const allStepKeys = [...new Set(batches.map(b => b.step_key))];
    for (const key of allStepKeys) {
      const stepBatches = batches.filter(b => b.step_key === key);
      stepCompletionMap.set(key, stepBatches.length > 0 && stepBatches.every(isTerminal));
    }

    const isStepComplete = (s) => {
      const name = typeof s === 'string' ? s : s.name;
      if (s.type === 'parallel') return s.steps.every(isStepComplete);
      return stepCompletionMap.get(name) === true;
    };

    const isStepRunning = (s) => {
      const name = typeof s === 'string' ? s : s.name;
      if (s.type === 'parallel') return s.steps.some(isStepRunning);
      const stepBatches = batches.filter(b => b.step_key === name);
      return stepBatches.length > 0 && !stepBatches.every(isTerminal);
    };

    const newActiveSteps = [];

    for (const step of workflowSteps) {
      const stepName = typeof step === 'string' ? step : step.name;
      const stepType = step.type || 'sync';

      if (isStepComplete(step)) continue;

      if (stepType === 'parallel') {
        for (const subStep of step.steps) {
          const subName = typeof subStep === 'string' ? subStep : subStep.name;
          if (!isStepComplete(subStep) && !isStepRunning(subStep)) {
            newActiveSteps.push(subName);
            await this.executeStep(sessionId, subName);
          } else if (isStepRunning(subStep)) {
            newActiveSteps.push(subName);
          }
        }
        if (newActiveSteps.length > 0) break;
      } else if (stepType === 'async') {
        if (!isStepRunning(step)) {
          await this.executeStep(sessionId, stepName);
        }
        continue;
      } else {
        if (!isStepRunning(step)) {
          newActiveSteps.push(stepName);
          await this.executeStep(sessionId, stepName);
        } else {
          newActiveSteps.push(stepName);
        }
        break;
      }
    }

    await this.persistence.updateSessionCurrentSteps(sessionId, newActiveSteps);

    if (newActiveSteps.length === 0) {
      const allDone = workflowSteps.every(isStepComplete);
      if (allDone) {
        await this._finalizeSession(sessionId, correlationId);
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
