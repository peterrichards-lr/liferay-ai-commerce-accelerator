const { ERC_PREFIX } = require('../utils/constants.cjs');
const {
  delay,
  resolvePhaseAndMode,
  now,
  isoNow,
  elapsedMs: elapsed,
  createERC,
  randomString,
} = require('../utils/misc.cjs');

class AccountGenerator {
  constructor(ctx) {
    this.ctx = ctx;
  }

  validateConfig(config) {
    const pollingRetriesValue = config.pollingRetries;
    if (pollingRetriesValue === undefined || pollingRetriesValue === null) {
      throw new Error('pollingRetries is required');
    }
    const pollingRetries = parseInt(pollingRetriesValue);
    if (isNaN(pollingRetries) || pollingRetries < 0 || pollingRetries > 20) {
      throw new Error('pollingRetries must be between 0 and 20');
    }
    const pollingDelayValue = config.pollingDelay;
    if (pollingDelayValue === undefined || pollingDelayValue === null) {
      throw new Error('pollingDelay is required');
    }
    const pollingDelay = parseInt(pollingDelayValue);
    if (isNaN(pollingDelay) || pollingDelay < 5000 || pollingDelay > 600000) {
      throw new Error('pollingDelay must be between 5 and 600 seconds');
    }
  }

  async validateOptions(options) {
    const { ai, logger } = this.ctx;
    if (
      !options.accountCount ||
      typeof options.accountCount !== 'number' ||
      options.accountCount <= 0
    ) {
      throw new Error('Account count must be greater than 0');
    }
    if (!options.demoMode) {
      try {
        await ai.getOpenAIClient();
        logger.trace('✓ OpenAI API key validated successfully');
      } catch (error) {
        const msg =
          'OpenAI API key not configured. Please set it in the AI Configuration object or enable demo mode.';
        logger.error(
          '✗ OpenAI key validation failed for accounts:',
          error.message
        );
        throw new Error(msg);
      }
    }
  }

  async generateAccounts(config, options) {
    const { logger, ai, mockData, cache, batchPolling, getWs, liferay } =
      this.ctx;
    const correlationId = config.correlationId;
    const useBatch = config.batchSize > 1 && options.accountCount > 1;
    const { mode, phase } = resolvePhaseAndMode({
      useBatch,
      phase: 'generate',
    });

    logger.info('Starting account generation', {
      correlationId,
      operation: 'accounts/generate:start',
      phase,
      mode,
      accountCount: options.accountCount || 0,
      demoMode: options.demoMode,
      batchSize: config.batchSize,
    });

    const results = { accounts: [], created: 0, errors: [] };

    try {
      this.validateConfig(config);
      await this.validateOptions(options);

      let accountDataList;
      if (options.demoMode) {
        accountDataList = mockData.generateAccountData(options.accountCount);
      } else {
        accountDataList = await ai.generateAccountData(
          options.accountCount,
          config.aiModel
        );
      }

      if (useBatch) {
        const callbackUrl =
          config.microserviceUrl && config.microserviceUrl !== 'null'
            ? `${config.microserviceUrl}/api/batch/callback`
            : null;
        const accountBatches = [];
        for (let i = 0; i < accountDataList.length; i += config.batchSize)
          accountBatches.push(accountDataList.slice(i, i + config.batchSize));
        const batchIds = [];

        for (
          let batchIndex = 0;
          batchIndex < accountBatches.length;
          batchIndex++
        ) {
          const batch = accountBatches[batchIndex];

          const batchERC = createERC(ERC_PREFIX.ACCOUNT_BATCH);
          const startedAt = now();
          cache.set(
            `erc:${batchERC}:config`,
            {
              correlationId,
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              createdAt: isoNow(),
              startedAt,
              entityType: 'accounts',
              liferayUrl: config.liferayUrl,
              localeCode: config.localeCode,
              operation: 'generate',
            },
            3600000
          );

          const batchResult = await liferay.createAccountsBatch(
            config,
            batch,
            callbackUrl,
            {
              externalReferenceCode: batchERC,
            }
          );

          cache.set(`erc:${batchERC}:batchId`, batchResult.batchId, 3600000);
          cache.set(
            `batch:${batchResult.batchId}:erc`,
            { externalReferenceCode: batchERC },
            3600000
          );

          cache.set(
            `batch:${batchResult.batchId}:meta`,
            {
              totalCount: batch.length,
              startedAt,
              externalReferenceCode: batchERC,
            },
            3600000
          );

          getWs().emitBatchStarted(
            {
              batchId: batchResult.batchId,
              entityType: 'accounts',
              totalItems: batch.length,
              operation: 'generate',
              mode,
              phase,
              externalReferenceCode: batchERC,
            },
            { correlationId }
          );

          batchIds.push(batchResult.batchId);

          if (batchResult.batchId && callbackUrl) {
            const pollInterval = Math.max(config.pollingDelay || 5000, 2000);
            const maxPollAttempts = config.pollingRetries || 120;

            batchPolling.startPolling(
              batchResult.batchId,
              {
                liferayUrl: config.liferayUrl,
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                localeCode: config.localeCode,
                entityType: 'accounts',
              },
              {
                pollInterval,
                maxPollAttempts,
                onStatusChange: (status) => {
                  const meta =
                    cache.get(`batch:${batchResult.batchId}:meta`) || {};
                  const total =
                    status.totalCount || meta.totalCount || batch.length || 0;
                  const processed = status.processedCount || 0;
                  const progress =
                    total > 0 ? Math.round((processed / total) * 100) : 0;
                  const elapsedMs = elapsed(meta.startedAt || now());
                  const rate = processed / (elapsedMs / 1000);
                  const remaining = Math.max(0, total - processed);
                  const etaSeconds =
                    rate > 0 ? Math.round(remaining / rate) : null;

                  getWs().emitBatchProgress(
                    {
                      batchId: status.batchId,
                      entityType: 'accounts',
                      completedCount: processed,
                      totalItems: total,
                      progress,
                      etaSeconds,
                      operation: 'generate',
                      mode,
                      phase,
                      externalReferenceCode: batchERC,
                    },
                    { correlationId }
                  );

                  logger.debug('Batch status update', {
                    operation: 'accounts/batch:progress',
                    batchId: status.batchId,
                    status: status.status,
                    processedCount: processed,
                    totalCount: total,
                    progress,
                    etaSeconds,
                  });
                },
                onComplete: (r) => this.handleBatchComplete(r, config),
                onError: (error) => {
                  logger.error('Batch polling error', {
                    operation: 'accounts/batch:error',
                    batchId: batchResult.batchId,
                    error: error.message,
                    entityType: 'accounts',
                  });
                  getWs().emitBatchFailed(
                    {
                      batchId: batchResult.batchId,
                      entityType: 'accounts',
                      successCount: 0,
                      failureCount: 1,
                      errors: [{ message: error.message }],
                      operation: 'generate',
                      mode,
                      phase,
                      externalReferenceCode: batchERC,
                    },
                    { correlationId }
                  );
                },
              }
            );
          }

          logger.info('Batch submission completed', {
            operation: 'accounts/batch:submit',
            batchId: batchResult.batchId,
            accountCount: batch.length,
            status: batchResult.status,
            callbackUrl: callbackUrl || 'none',
            mode,
            phase,
          });

          results.accounts.push({
            batchIndex: batchIndex + 1,
            totalBatches: accountBatches.length,
            batchId: batchResult.batchId,
            status: batchResult.status,
            accountCount: batch.length,
            externalReferenceCode: batchERC,
            accounts: batch.map((p) => ({
              name: p.name?.en_US || p.name,
              externalReferenceCode: p.externalReferenceCode,
            })),
          });
          results.created += batch.length;

          if (batchIndex < accountBatches.length - 1) await delay(1000);
        }

        return {
          accounts: results.accounts,
          created: results.created,
          errors: results.errors,
          batchIds,
          success: results.errors.length === 0,
        };
      } else {
        return await this.generateAccountsIndividually(
          config,
          options,
          accountDataList
        );
      }
    } catch (error) {
      logger.error('Account generation failed', {
        correlationId,
        operation: 'accounts/generate:error',
        error: error.message,
        mode,
        phase,
      });
      throw error;
    }
  }

  async generateAccountsIndividually(config, options, accountDataList) {
    const { logger, getWs } = this.ctx;
    const { mode, phase } = resolvePhaseAndMode({
      useBatch: false,
      phase: 'generate',
    });
    const generatedAccounts = [];
    const errors = [];

    const metaKey = 'accounts-individual:meta';
    const startedAt = now();
    this.ctx.cache.set(
      metaKey,
      { total: accountDataList.length, startedAt },
      3600000
    );

    getWs().emitBatchStarted(
      {
        batchId: 'accounts-individual',
        entityType: 'accounts',
        totalItems: accountDataList.length,
        operation: 'generate',
        mode,
        phase,
      },
      { correlationId: config.correlationId }
    );

    for (let i = 0; i < accountDataList.length; i++) {
      const accountData = accountDataList[i];
      try {
        const createdAccount = await this.createSingleAccount(
          config,
          accountData
        );
        generatedAccounts.push(createdAccount);

        const processed = i + 1;
        const total = accountDataList.length;
        const progress = Math.round((processed / total) * 100);
        const meta = this.ctx.cache.get(metaKey) || { startedAt };
        const elapsedMs = elapsed(meta.startedAt || now());
        const rate = processed / (elapsedMs / 1000);
        const remaining = Math.max(0, total - processed);
        const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;

        getWs().emitBatchProgress(
          {
            batchId: 'accounts-individual',
            entityType: 'accounts',
            completedCount: processed,
            totalItems: total,
            progress,
            etaSeconds,
            operation: 'generate',
            mode,
            phase,
          },
          { correlationId: config.correlationId }
        );

        logger.trace(`✓ Created account: ${createdAccount.name}`);
      } catch (error) {
        errors.push({ index: i, error: error.message, accountData });
        logger.error('Account creation failed', {
          correlationId: config.correlationId,
          operation: 'accounts/create:error',
          error: error.message,
          accountIndex: i,
          mode: options.demoMode ? 'demo' : 'live',
        });
      }
    }

    this.emitCompletion(
      'accounts-individual',
      generatedAccounts.length,
      errors.length,
      errors,
      config,
      { mode, phase }
    );

    logger.info('Account generation completed', {
      correlationId: config.correlationId,
      operation: 'accounts/generate:complete',
      created: generatedAccounts.length,
      errors: errors.length,
      mode: options.demoMode ? 'demo' : 'live',
    });

    return {
      accounts: generatedAccounts,
      created: generatedAccounts.length,
      errors,
      success: errors.length === 0,
    };
  }

  async createSingleAccount(config, accountData) {
    const { logger, liferay } = this.ctx;
    try {
      const liferayAccount = {
        name: accountData.name || `Generated Company ${randomString()}`,
        description: accountData.description || 'AI generated business account',
        type: accountData.type || 'business',
        domains: accountData.domains || [`company${randomString()}.com`],
        externalReferenceCode:
          accountData.externalReferenceCode || createERC(ERC_PREFIX.ACCOUNT),
        taxId: accountData.taxId || this.generateTaxId(),
      };

      if (accountData.emailAddress) {
        liferayAccount.accountContactInformation = {
          emailAddresses: [
            {
              emailAddress: accountData.emailAddress,
              primary: true,
              type: 'email-address',
            },
          ],
          postalAddresses: [],
          telephones: [],
          webUrls: [],
        };
      }

      const createdAccount = await liferay.createAccount(
        config,
        liferayAccount
      );

      logger.info('Account created successfully', {
        correlationId: config.correlationId,
        operation: 'accounts/create:success',
        accountId: createdAccount.id,
        accountName: createdAccount.name,
      });

      return createdAccount;
    } catch (error) {
      logger.error('Failed to create account', {
        correlationId: config.correlationId,
        operation: 'accounts/create:error',
        error: error.message,
        accountName: accountData.name || 'unknown',
      });
      throw error;
    }
  }

  handleBatchComplete(results, config) {
    const { logger, getWs } = this.ctx;
    const { mode, phase } = resolvePhaseAndMode({
      useBatch: true,
      phase: 'complete',
    });

    logger.info('Handling account batch completion', {
      operation: 'accounts/batch:complete',
      batchId: results.batchId,
      status: results.status,
      processedCount: results.processedCount,
      totalCount: results.totalCount,
    });

    const content = results.content;
    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    if (Array.isArray(content)) {
      content.forEach((item, index) => {
        if (item.status === 'SUCCESS' || item.status === 'CREATED') {
          successCount++;
        } else {
          failureCount++;
          failures.push({
            index,
            error: item.error || item.message || 'Unknown error',
          });
        }
      });
    } else {
      successCount = results.processedCount || results.totalCount || 0;
    }

    getWs().emitBatchCompleted(
      {
        batchId: results.batchId,
        entityType: 'accounts',
        successCount,
        failureCount,
        errors: failures.slice(0, 5),
        operation: 'generate',
        mode,
        phase,
        externalReferenceCode: (
          this.ctx.cache.get(`batch:${results.batchId}:erc`) || {}
        ).externalReferenceCode,
      },
      { correlationId: config.correlationId }
    );
  }

  emitCompletion(
    batchId,
    successCount,
    failureCount,
    failures,
    config,
    ctx = {}
  ) {
    const { getWs } = this.ctx;
    const extra = ctx.mode ? { mode: ctx.mode, phase: ctx.phase } : {};
    getWs().emitBatchCompleted(
      {
        batchId,
        entityType: 'accounts',
        successCount,
        failureCount,
        errors: (failures || []).slice(0, 5),
        operation: 'generate',
        ...extra,
      },
      { correlationId: config.correlationId }
    );
  }

  generateTaxId() {
    const firstTwo = Math.floor(Math.random() * 99) + 1;
    const lastSeven = Math.floor(Math.random() * 8999999) + 1000000;
    return `${firstTwo.toString().padStart(2, '0')}-${lastSeven}`;
  }

  async getExistingAccounts(config) {
    const { logger, liferay } = this.ctx;
    try {
      return await liferay.getAccounts(config);
    } catch (error) {
      logger.error('Failed to fetch existing accounts:', error);
      return [];
    }
  }
}

module.exports = AccountGenerator;
