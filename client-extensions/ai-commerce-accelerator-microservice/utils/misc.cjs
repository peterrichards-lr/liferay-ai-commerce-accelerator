async function handleDemoAccountGeneration(req, res) {
  const {
    liferayUrl,
    clientId,
    clientSecret,
    count,
    microserviceUrl,
    pollingDelay,
    batchSize,
  } = req.body;

  try {
    logger.info('Demo account generation started', {
      correlationId: req.correlationId,
      operation: 'demo-generate-accounts',
      accountCount: count,
      batchSize: batchSize,
      pollingDelay: pollingDelay,
    });

    console.log(
      `Demo mode: Generating ${count} mock accounts using batch endpoint with batch size: ${batchSize}`
    );

    const validPollingDelay = parseInt(pollingDelay) || 10;
    const validBatchSize = parseInt(batchSize) || 5;

    const config = {
      liferayUrl,
      clientId,
      clientSecret,
      demoMode: true,
      microserviceUrl,
      pollingDelay: validPollingDelay,
      batchSize: validBatchSize,
      count: parseInt(count),
    };

    const shouldUseBatch = count > 5;
    const actualBatchSize = shouldUseBatch ? Math.max(validBatchSize, 5) : 1;

    const result = await accountGenerator.generateAccounts(config, {
      count: count,
      batchSize: actualBatchSize,
    });

    // Handle both batch and individual responses
    if (result.batchId) {
      // Batch response
      logger.info('Demo account batch generation completed successfully', {
        correlationId: req.correlationId,
        operation: 'demo-generate-accounts',
        batchId: result.batchId,
        accountCount: result.count,
        usedBatch: true,
      });

      res.json({
        success: true,
        batchId: result.batchId,
        count: result.count,
        status: result.status,
        message: result.message,
        demoMode: true,
        batch: true,
      });
    } else if (result.success) {
      // Individual response
      logger.info('Demo account generation completed successfully', {
        correlationId: req.correlationId,
        operation: 'demo-generate-accounts',
        accountCount: result.created,
        usedBatch: false,
      });

      res.json({
        success: true,
        count: result.created,
        errors: result.errors,
        message: `Successfully generated ${result.created} demo accounts using individual creation`,
        demoMode: true,
        batch: false,
      });
    } else {
      logger.error('Demo account generation failed', {
        correlationId: req.correlationId,
        operation: 'demo-generate-accounts',
        error: result.error || 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: result.error || 'Account generation failed',
        demoMode: true,
      });
    }
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: req.correlationId,
      operation: 'demo-generate-accounts',
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Demo account generation failed',
      demo: true,
    });
  }
}