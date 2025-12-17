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
const {
  getBatchCacheTTLms,
  getLongLivedTTLms,
  getEphemeralTTLms,
} = require('../utils/ttl.cjs');

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

  async validateOptions(config, options) {
    const { ai, logger } = this.ctx;

    if (
      !options.accountCount ||
      typeof options.accountCount !== 'number' ||
      options.accountCount <= 0
    ) {
      throw new Error('Account count must be greater than 0');
    }

    if (!options.demoMode) {
      if (!config.aiModel) {
        const err = new Error(
          'AI model not configured. Please select an AI model in the AI Configuration object.'
        );
        err.statusCode = 400;
        logger.error(
          '✗ AI model validation failed for accounts: missing aiModel'
        );
        throw err;
      }

      try {
        await ai.getOpenAIClient(config);
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
    const {
      logger,
      ai,
      mockData,
      cache,
      batchPolling,
      ws,
      liferay,
      configService,
    } = this.ctx;
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
      await this.validateOptions(config, options);

      let accountDataList;
      if (options.demoMode) {
        accountDataList = mockData.generateAccountData(options.accountCount);
      } else {
        accountDataList = await ai.generateAccountData(
          options.accountCount,
          config,
          config.aiModel
        );
      }

      const accountsWithAddresses = accountDataList.map((raw) => {
        const account = { ...raw };

        if (
          account.emailAddress ||
          account.domains ||
          (account.accountContactInformation &&
            account.accountContactInformation.domains)
        ) {
          account.accountContactInformation =
            account.accountContactInformation || {};

          if (account.emailAddress) {
            account.accountContactInformation.emailAddresses = [
              {
                emailAddress: account.emailAddress,
                primary: true,
                type: 'email-address',
              },
            ];
            delete account.emailAddress;
          }

          const allDomains = [
            ...(account.domains || []),
            ...(account.accountContactInformation?.domains || []),
          ];

          if (allDomains.length > 0) {
            account.accountContactInformation.webUrls = allDomains.map(
              (domain) => ({
                url: `http://${domain}`,
                urlType: 'Website',
                primary: false,
              })
            );
          }

          if (account.domains) {
            delete account.domains;
          }
          if (account.accountContactInformation?.domains) {
            delete account.accountContactInformation.domains;
          }

          if (account.headOfficeAddress) {
            account.accountContactInformation.postalAddresses = [
              {
                ...account.headOfficeAddress,
                primary: true,
                addressType: 'head-office',
              },
            ];
          }
        }

        delete account.businessAccounts;
        delete account.businessAccountsERC;

        account.billingAddress =
          account.billingAddress || this._generateAddress('billing');
        account.shippingAddress =
          account.shippingAddress || this._generateAddress('shipping');

        return account;
      });

      this.ctx.cache.set(
        'generated-data:accounts',
        accountsWithAddresses,
        getLongLivedTTLms(configService)
      );

      if (useBatch) {
        const accountsForBatch = accountsWithAddresses.map((account) => {
          const {
            billingAddress,
            shippingAddress,
            headOfficeAddress,
            ...rest
          } = account;
          return rest;
        });

        logger.debug('accountsForBatch', { accountsForBatch });

        const callbackUrl =
          config.microserviceUrl && config.microserviceUrl !== 'null'
            ? `${config.microserviceUrl}/api/batch/callback`
            : null;
        const accountBatches = [];
        for (let i = 0; i < accountsForBatch.length; i += config.batchSize)
          accountBatches.push(accountsForBatch.slice(i, i + config.batchSize));
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
            getLongLivedTTLms(configService)
          );

          const cbUrl = callbackUrl
            ? `${callbackUrl}?batchERC=${encodeURIComponent(batchERC)}&entity=accounts&opCode=C`
            : null;
          const batchResult = await liferay.createAccountsBatch(
            config,
            batch,
            cbUrl,
            {
              externalReferenceCode: batchERC,
            }
          );

          cache.set(
            `erc:${batchERC}:batchId`,
            batchResult.batchId,
            getLongLivedTTLms(configService)
          );
          cache.set(
            `batch:${batchResult.batchId}:erc`,
            { externalReferenceCode: batchERC },
            getLongLivedTTLms(configService)
          );

          cache.set(
            `batch:${batchResult.batchId}:meta`,
            {
              totalCount: batch.length,
              startedAt,
              externalReferenceCode: batchERC,
            },
            getBatchCacheTTLms(configService)
          );

          ws.emitBatchStarted(
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
                externalReferenceCode: batchERC,
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
                
                                    ws.emitBatchProgress(
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
                                  onError: (error) => {
                                    logger.error('Batch polling error', {
                                      operation: 'accounts/batch:error',
                                      batchId: batchResult.batchId,
                                      error: error.message,
                                      entityType: 'accounts',
                                    });
                                    ws.emitBatchFailed(
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
                                  },                entityType: 'accounts',
                operation: 'generate',
                mode: 'batch',
                affectsProgress: false,
              }
            );
          }

          logger.info('Batch submission completed', {
            operation: 'accounts/batch:submit',
            batchId: batchResult.batchId,
            accountCount: batch.length,
            status: batchResult.status,
            callbackUrl: cbUrl || 'none',
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
          accountsWithAddresses
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
    const { logger, ws, configService, cache, liferay } = this.ctx;
    const { mode, phase } = resolvePhaseAndMode({
      useBatch: false,
      phase: 'generate',
    });
    const generatedAccounts = [];
    const errors = [];

    const metaKey = 'accounts-individual:meta';
    const startedAt = now();
    cache.set(
      metaKey,
      { total: accountDataList.length, startedAt },
      getEphemeralTTLms(configService)
    );

    ws.emitBatchStarted(
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
        const {
          billingAddress,
          shippingAddress,
          headOfficeAddress,
          ...account
        } = accountData;

        const createdAccount = await liferay.createAccount(config, account);

        let billingAddressRes, shippingAddressRes;

        if (billingAddress) {
          const { name, ...billingAddressData } = billingAddress;
          billingAddressRes = await liferay.createAccountAddress(
            config,
            createdAccount.id,
            { ...billingAddressData, primary: true, addressType: 'billing' }
          );
        }

        if (shippingAddress) {
          const { name, ...shippingAddressData } = shippingAddress;
          shippingAddressRes = await liferay.createAccountAddress(
            config,
            createdAccount.id,
            { ...shippingAddressData, primary: false, addressType: 'shipping' }
          );
        }

        if (billingAddressRes || shippingAddressRes) {
          await liferay.patchAccount(config, createdAccount.id, {
            defaultBillingAddressId: billingAddressRes?.id,
            defaultShippingAddressId: shippingAddressRes?.id,
          });
        }

        generatedAccounts.push(createdAccount);

        const processed = i + 1;
        const total = accountDataList.length;
        const progress = Math.round((processed / total) * 100);
        const meta = cache.get(metaKey) || { startedAt };
        const elapsedMs = elapsed(meta.startedAt || now());
        const rate = processed / (elapsedMs / 1000);
        const remaining = Math.max(0, total - processed);
        const etaSeconds = rate > 0 ? Math.round(remaining / rate) : null;

        ws.emitBatchProgress(
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



      emitCompletion(
    batchId,
    successCount,
    failureCount,
    failures,
    config,
    ctx = {}
  ) {
    const { ws } = this.ctx;
    const extra = ctx.mode ? { mode: ctx.mode, phase: ctx.phase } : {};
    ws.emitBatchCompleted(
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

  _generateAddress(addressType) {
    const streetNumber = Math.floor(Math.random() * 999) + 1;
    const streetName = randomString(8);
    const streetType = ['Street', 'Avenue', 'Road', 'Lane'][
      Math.floor(Math.random() * 4)
    ];
    const city = randomString(6);
    const state = randomString(2).toUpperCase();
    const postalCode = `${Math.floor(Math.random() * 99999) + 10000}`;
    const country = randomString(2).toUpperCase();

    return {
      streetAddressLine1: `${streetNumber} ${streetName} ${streetType}`,
      city,
      addressRegion: state,
      postalCode,
      addressCountry: country,
      addressType,
      primary: true,
      externalReferenceCode: createERC(ERC_PREFIX.ADDRESS),
    };
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