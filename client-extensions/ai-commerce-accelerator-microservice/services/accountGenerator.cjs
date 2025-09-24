const aiService = require('./aiService.cjs');
const liferayService = require('./liferayService.cjs');
const { MockDataGenerator } = require('./mockDataGenerator.cjs');
const { logger } = require('../utils/logger.cjs');
const { BatchPollingService } = require('./batchPollingService.cjs');
const { cacheService } = require('./cacheService.cjs'); // Assuming cacheService is available here

class AccountGenerator {
  constructor(wss = null) {
    this.aiService = aiService; // Make aiService accessible within the class
    this.mockDataGenerator = new MockDataGenerator();
    this.batchPollingService = new BatchPollingService(wss); // Initialize the polling service with WebSocket server
  }

  setWebSocketServer(wss) {
    this.batchPollingService.setWebSocketServer(wss);
  }

  async generateAccounts(config, options) {
    const correlationId = config.correlationId || uuidv4();
    const useBatch = config.batchSize > 1 && options.accountCount > 1;

    logger.info('Starting account generation', {
      correlationId: correlationId,
      operation: 'generate-accounts',
      accountCount: options.accountCount || 0,
      useBatch,
      demoMode: options.demoMode,
      batchSize: config.batchSize,
    });

    const results = {
      accounts: [],
      created: 0,
      errors: [],
    };

    try {
      // Early validation for OpenAI key if not in demo mode
      if (!options.demoMode) {
        try {
          await this.aiService.getOpenAIClient();
          console.log('✓ OpenAI API key validated for account generation');
        } catch (error) {
          const errorMessage =
            'OpenAI API key not configured. Please set it in the AI Configuration object or enable demo mode.';
          console.error(
            '✗ OpenAI key validation failed for accounts:',
            error.message
          );
          throw new Error(errorMessage);
        }
      }

      console.log(`=== STARTING ACCOUNT GENERATION ===`);
      console.log(
        `Count: ${options.accountCount}, Batch mode: ${useBatch}, Demo mode: ${options.demoMode}, Batch size: ${config.batchSize}`
      );
      console.log(`Target Liferay URL: ${config.liferayUrl}`);

      let accountDataList;
      if (options.demoMode) {
        console.log(
          `Demo mode: Generating ${options.accountCount} mock accounts`
        );
        const mockGen = new MockDataGenerator();
        accountDataList = mockGen.generateAccountData(options.accountCount);
        console.log(
          `Demo: Generated ${accountDataList.length} mock account data entries`
        );
      } else {
        console.log(
          `AI mode: Generating ${options.accountCount} accounts using ${config.aiModel}`
        );
        accountDataList = await this.aiService.generateAccountData(
          options.accountCount,
          config.aiModel || 'gpt-4o'
        );
        console.log(
          `AI: Generated ${accountDataList.length} account data entries`
        );
      }

      if (useBatch) {
        console.log(
          `Creating ${accountDataList.length} accounts using batch endpoint with batch size ${config.batchSize}...`
        );

        const callbackUrl =
          config.microserviceUrl && config.microserviceUrl !== 'null'
            ? `${config.microserviceUrl}/api/batch/callback`
            : null;

        // Split account into batches based on batchSize
        const accountBatches = [];
        for (let i = 0; i < accountDataList.length; i += config.batchSize) {
          accountBatches.push(accountDataList.slice(i, i + config.batchSize));
        }

        console.log(
          `Split ${accountDataList.length} products into ${accountBatches.length} batches of max size ${config.batchSize}`
        );

        const batchIds = [];
        // Process each batch
        for (
          let batchIndex = 0;
          batchIndex < accountBatches.length;
          batchIndex++
        ) {
          const batch = accountBatches[batchIndex];
          console.log(
            `Submitting batch ${batchIndex + 1}/${accountBatches.length} with ${
              batch.length
            } accounts...`
          );

          const result = await this.createAccountsBatch(
            config,
            batch,
            callbackUrl
          );

          batchIds.push(result.batchId); // Store batchId

          // Store batch config for polling (if callback URL is provided)
          if (result.batchId && callbackUrl) {
            // Get poll interval from config with validation
            const pollInterval = Math.max(config.pollInterval || 5000, 2000); // Minimum 2 seconds
            const maxPollAttempts = config.maxPollAttempts || 120; // Default 10 minutes

            const { cacheService } = require('./cacheService.cjs');
            cacheService.set(
              `batch:${result.batchId}:config`,
              {
                liferayUrl: config.liferayUrl,
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                localeCode: config.localeCode,
                entityType: 'accounts',
                createdAt: new Date().toISOString(),
              },
              3600000 // 1 hour cache
            );

            logger.info('Batch config stored for polling', {
              operation: 'batch-config-store',
              batchId: result.batchId,
              pollInterval,
              maxPollAttempts,
            });

            // Start polling for this batch
            this.batchPollingService.startPolling(
              result.batchId,
              {
                liferayUrl: config.liferayUrl,
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                localeCode: config.localeCode,
                entityType: 'accounts',
              },
              {
                pollInterval: config.pollingDelay * 1000, // Convert to milliseconds
                maxPollAttempts: Math.ceil(
                  600000 / (config.pollingDelay * 1000)
                ), // Max 10 minutes
                onStatusChange: (status) => {
                  logger.log('debug', 'Batch status update', {
                    operation: 'batch-status-update',
                    batchId: status.batchId,
                    status: status.status,
                    processedCount: status.processedCount,
                    totalCount: status.totalCount,
                  });
                },
                onComplete: (results) => {
                  this.handleBatchComplete(results);
                },
                onError: (error) => {
                  logger.log('error', 'Batch polling error', {
                    operation: 'batch-polling-error',
                    batchId: result.batchId,
                    error: error.message,
                  });
                },
              }
            );
          }

          logger.info('Batch submission completed', {
            operation: 'create-products-batch',
            batchId: result.batchId,
            productCount: batch.length,
            status: result.status,
            callbackUrl: callbackUrl || 'none',
          });

          results.accounts.push({
            batchIndex: batchIndex + 1,
            totalBatches: accountBatches.length,
            batchId: result.batchId,
            status: result.status,
            accountCount: batch.length,
            accounts: batch.map((p) => ({
              name: p.name?.en_US || p.name,
              externalReferenceCode: p.externalReferenceCode,
            })),
          });
          results.created += batch.length;

          // Add delay between batch submissions to avoid overwhelming the server
          if (batchIndex < accountBatches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        return results;
      } else {
        console.log(
          `Using individual operations for ${accountDataList.length} accounts`
        );
        return await this.generateAccountsIndividually(
          config,
          options,
          accountDataList
        );
      }
    } catch (error) {
      logger.error('Account generation failed', {
        correlationId: correlationId,
        operation: 'generate-accounts',
        error: error.message,
      });
      throw error;
    }
  }

  async generateAccountsIndividually(config, options, accountDataList) {
    const generatedAccounts = [];
    const errors = [];

    // Generate accounts using the same mechanism for both demo and live modes
    for (let i = 0; i < accountDataList.length; i++) {
      const accountData = accountDataList[i];

      try {
        // Both modes use the same Liferay API mechanism
        const createdAccount = await this.createSingleAccount(
          config,
          accountData
        );
        generatedAccounts.push(createdAccount);

        logger.info('Account created successfully', {
          correlationId: config.correlationId,
          operation: 'create-account',
          accountId: createdAccount.id,
          accountName: createdAccount.name,
          mode: options.demoMode ? 'demo' : 'live',
        });
      } catch (error) {
        logger.error('Account creation failed', {
          correlationId: config.correlationId,
          operation: 'create-account',
          error: error.message,
          accountIndex: i,
          mode: options.demoMode ? 'demo' : 'live',
        });

        errors.push({
          index: i,
          error: error.message,
          accountData: accountData,
        });
      }
    }

    logger.info('Account generation completed', {
      correlationId: config.correlationId,
      operation: 'generate-accounts',
      created: generatedAccounts.length,
      errors: errors.length,
      mode: options.demoMode ? 'demo' : 'live',
    });

    return {
      success: true,
      accounts: generatedAccounts,
      count: generatedAccounts.length,
      created: generatedAccounts.length,
      errors: errors,
    };
  }

  async generateAccountsBatch(config, accountsData, callbackUrl) {
    try {
      logger.info('Starting batch account generation', {
        correlationId: config.correlationId,
        operation: 'generate-accounts-batch',
        count: accountsData.length,
        aiModel: config.aiModel,
      });

      // Prepare accounts for batch creation
      const accountsForBatch = accountsData.map((accountData) => ({
        name: accountData.name || `Generated Company ${Date.now()}`,
        description: accountData.description || 'AI generated business account',
        type: accountData.type || 'business',
        domains: accountData.domains || [`company${Date.now()}.com`],
        externalReferenceCode:
          accountData.externalReferenceCode ||
          `ACC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        taxId: accountData.taxId || this.generateTaxId(),
        ...(accountData.emailAddress && {
          accountContactInformation: {
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
          },
        }),
      }));

      const batchResult = await liferayService.createAccountsBatch(
        config,
        accountsData, // Ensure this is the correct data format for liferayService
        callbackUrl
      );

      // Store batch config for polling
      const batchId = batchResult.batchId;
      // Store configuration for polling callback
      cacheService.set(
        `batch:${batchId}:config`,
        {
          liferayUrl: config.liferayUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          localeCode: config.localeCode,
          entityType: 'accounts',
          createdAt: new Date().toISOString(),
        },
        1800000 // 30 minutes
      );

      const pollingDelay = parseInt(config.pollingDelay); // Assuming pollingDelay is already validated in generateAccounts
      const pollInterval = pollingDelay;
      const maxPollAttempts = Math.ceil(600000 / pollInterval); // Max 10 minutes (600 seconds)

      // Start polling for this batch
      this.batchPollingService.startPolling(batchId, {
        ...config,
        entityType: 'accounts', // Ensure entityType is passed to polling service
        pollInterval,
        maxPollAttempts,
        onComplete: (results) => {
          this.handleBatchComplete(results);
        },
        onError: (error) => {
          logger.error('Account batch polling error', {
            operation: 'batch-polling-error',
            batchId,
            error: error.message,
          });
        },
      });

      logger.info('Batch account creation initiated', {
        correlationId: config.correlationId,
        operation: 'generate-accounts-batch',
        batchId: batchResult.batchId,
        accountCount: accountsData.length,
      });

      return {
        success: true,
        batchId: batchResult.batchId,
        count: accountsData.length,
        status: 'processing',
        message: `Batch creation initiated for ${accountsData.length} accounts`,
      };
    } catch (error) {
      logger.error('Batch account generation failed', {
        correlationId: config.correlationId,
        operation: 'generate-accounts-batch',
        error: error.message,
        count: accountsData.length,
      });

      throw error;
    }
  }

  async createAccountsBatch(config, accountsData, callbackUrl) {
    try {
      logger.info('Creating accounts batch with callback', {
        correlationId: config.correlationId,
        operation: 'create-accounts-batch',
        accountCount: accountsData.length,
        callbackUrl: callbackUrl,
      });

      const batchResult = await liferayService.createAccountsBatch(
        config,
        accountsData,
        callbackUrl
      );

      return {
        ...batchResult,
        count: accountsData.length,
      };
    } catch (error) {
      logger.error('Failed to create accounts batch', {
        correlationId: config.correlationId,
        operation: 'create-accounts-batch',
        error: error.message,
        accountCount: accountsData.length,
      });
      throw error;
    }
  }

  async createSingleAccount(config, accountData) {
    try {
      const liferayAccount = {
        name: accountData.name || `Generated Company ${Date.now()}`,
        description: accountData.description || 'AI generated business account',
        type: accountData.type || 'business',
        domains: accountData.domains || [`company${Date.now()}.com`],
        externalReferenceCode:
          accountData.externalReferenceCode ||
          `ACC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

      logger.info('Creating account with Liferay API', {
        correlationId: config.correlationId,
        operation: 'create-account',
        accountName: liferayAccount.name,
        hasEmail: !!accountData.emailAddress,
      });

      const createdAccount = await liferayService.createAccount(
        config,
        liferayAccount
      );

      logger.info('Account created successfully', {
        correlationId: config.correlationId,
        operation: 'create-account',
        accountId: createdAccount.id,
        accountName: createdAccount.name,
      });

      return createdAccount;
    } catch (error) {
      logger.error('Failed to create account', {
        correlationId: config.correlationId,
        operation: 'create-account',
        error: error.message,
        accountName: accountData.name || 'unknown',
      });
      throw error;
    }
  }

  generateTaxId() {
    const firstTwo = Math.floor(Math.random() * 99) + 1;
    const lastSeven = Math.floor(Math.random() * 9999999) + 1000000;
    return `${firstTwo.toString().padStart(2, '0')}-${lastSeven}`;
  }

  async getExistingAccounts(config) {
    try {
      return await liferayService.getAccounts(config);
    } catch (error) {
      console.error('Failed to fetch existing accounts:', error);
      return [];
    }
  }

  handleBatchComplete(results) {
    logger.info('Handling account batch completion', {
      operation: 'batch-complete-handler',
      batchId: results.batchId,
      status: results.status,
      processedCount: results.processedCount,
      totalCount: results.totalCount,
    });

    // Process batch results and determine success/failure counts
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
      // If content is not an array, assume all were successful if status is COMPLETED
      successCount = results.processedCount || results.totalCount || 0;
    }
  }
}

module.exports = AccountGenerator;
