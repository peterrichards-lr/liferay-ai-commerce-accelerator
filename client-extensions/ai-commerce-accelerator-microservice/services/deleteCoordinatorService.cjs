const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class DeleteCoordinatorService {
  constructor(ctx) {
    this.ctx = ctx;
  }

  runDeleteAndMonitor(config, options = {}) {
    const { logger, persistence, batchCallback } = this.ctx;

    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

    const steps = [
      { name: 'deleteOrders', type: 'sync' },
      { name: 'deleteWarehouses', type: 'sync' },
      { name: 'deleteAccounts', type: 'sync' },
      { name: 'deleteProducts', type: 'sync' },
      { name: 'deletePriceLists', type: 'sync' },
      { name: 'deleteSpecifications', type: 'sync' },
      { name: 'deleteOptions', type: 'sync' },
      { name: 'deleteOptionCategories', type: 'sync' },
    ];

    persistence.createSession({
      sessionId,
      flowType: 'delete',
      status: 'STARTED',
      currentSteps: [],
      context: {
        config,
        options,
        sessionId, // Pass it explicitly in context
        steps, // Store the full workflow definition
      },
    });

    // Directly start the first step; batchCallback will handle subsequent steps
    batchCallback._checkSessionCompletion(sessionId, config.correlationId);

    logger.info('Started full environment deletion process', {
      sessionId,
      steps: steps.map((s) => s.name),
    });

    return {
      sessionId,
      message: 'Full environment deletion process started.',
      steps: steps.map((s) => s.name),
    };
  }

  async runDeleteSelectedAndMonitor(
    config,
    options = {},
    { channelId, catalogId, deleteScope }
  ) {
    const { logger, persistence, batchCallback } = this.ctx;

    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

    // deleteScope is expected to be an array of step objects, e.g., [{ name: 'deleteAccounts', type: 'sync' }]
    const steps = Array.isArray(deleteScope) ? deleteScope : [];

    if (steps.length === 0) {
      return {
        sessionId,
        message: 'No entities selected for deletion.',
        steps: [],
      };
    }

    await persistence.createSession({
      sessionId,
      flowType: 'delete',
      status: 'STARTED',
      currentSteps: [],
      context: {
        config,
        options,
        channelId,
        catalogId,
        steps, // Store the full workflow definition
      },
    });

    // Kick off the workflow.
    batchCallback._checkSessionCompletion(sessionId, config.correlationId);

    logger.info('Started sequential deletion process for selected data', {
      sessionId,
      steps: steps.map((s) => s.name),
      channelId,
      catalogId,
    });

    return {
      sessionId,
      message: 'Sequential deletion process for selected data started.',
      steps: steps.map((s) => s.name),
    };
  }

}

module.exports = DeleteCoordinatorService;
