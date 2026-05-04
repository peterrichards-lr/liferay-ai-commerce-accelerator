const BaseGenerator = require('./baseGenerator.cjs');

/**
 * WorkflowCoordinator - A master generator that can orchestrate steps
 * across multiple specialized generators. Used for combined generation flows.
 */
class WorkflowCoordinator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);
    this.generators = {};
  }

  /**
   * Registers a specialized generator instance.
   */
  registerGenerator(name, instance) {
    this.generators[name] = instance;
    // We don't merge this.steps because we want to maintain the delegation model
  }

  /**
   * Overrides verifySteps to verify all registered sub-generators.
   */
  verifySteps() {
    super.verifySteps();
    for (const generator of Object.values(this.generators)) {
      generator.verifySteps();
    }
  }

  /**
   * Overrides executeStep to delegate to the appropriate generator.
   */
  async executeStep(sessionId, stepName) {
    const session = await this.persistence.getSession(sessionId);
    if (!session) return;

    // Find which generator handles this step
    const targetGenerator = Object.values(this.generators).find(
      (g) => !!g.steps[stepName]
    );

    if (targetGenerator) {
      this.logger.info(
        `Delegating step '${stepName}' to ${targetGenerator.constructor.name}`,
        { sessionId }
      );
      // Call the target generator's executeStep logic
      // We must use targetGenerator as 'this' context for the call
      return await targetGenerator.executeStep(sessionId, stepName);
    }

    // Fallback to base logic if no specialized handler found
    return await super.executeStep(sessionId, stepName);
  }

  /**
   * Standardized entry point (not used as much for the coordinator as it's usually
   * initialized via routes/generate.cjs)
   */
  async runWorkflow(_config, _options) {
    throw new Error(
      'WorkflowCoordinator should be initialized via combined workflow logic in routes.'
    );
  }
}

module.exports = WorkflowCoordinator;
