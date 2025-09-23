const aiService = require('./aiService.cjs');
const liferayService = require('./liferayService.cjs');
const { MockDataGenerator } = require('./mockDataGenerator.cjs');
const { logger } = require('../utils/logger.cjs');
const { v4: uuidv4 } = require('uuid');
const { cacheService } = require('./cacheService.cjs'); // Assuming cacheService is available here

class AccountGenerator {
  constructor() {
    this.mockDataGenerator = new MockDataGenerator();
    this.aiService = aiService; // Make aiService accessible within the class
    // Initialize batchPollingService and websocketService if they are part of the class
    // For this example, we'll assume they are initialized elsewhere or are static
    // If they are instance members, they should be initialized in the constructor.
    // Example:
    // const BatchPollingService = require('./batchPollingService.cjs');
    // this.batchPollingService = new BatchPollingService();
    // const WebsocketService = require('./websocketService.cjs');
    // this.websocketService = WebsocketService; // Or new WebsocketService() depending on its design
    // For now, we'll use placeholders to avoid breaking the code if these are not yet implemented/imported
    this.batchPollingService = {
      startPolling: () => {} // Placeholder
    };
    this.websocketService = {
      broadcastBatchUpdate: () => {} // Placeholder
    };
  }

  async generateAccounts(config, options = {}) {
    const correlationId = uuidv4();

    // Use the configured batch size from config, not derived from count
    const batchSize = config.batchSize || 1;
    // Use batch mode when batchSize > 1
    const effectiveUseBatch = batchSize > 1;

    logger.info('Starting account generation', {
      correlationId: correlationId,
      operation: 'generate-accounts',
      accountCount: options.count || 0,
      useBatch: effectiveUseBatch,
      demoMode: !!config.demoMode,
      batchSize: batchSize,
    });

    const results = {
      accounts: [],
      created: 0,
      errors: [],
    };

    try {
      // Early validation for OpenAI key if not in demo mode
      if (!config.demoMode && !options.demoMode) {
        try {
          await this.aiService.getOpenAIClient();
          console.log('✓ OpenAI API key validated for account generation');
        } catch (error) {
          const errorMessage = 'OpenAI API key not configured. Please set it in the AI Configuration object or enable demo mode.';
          console.error('✗ OpenAI key validation failed for accounts:', error.message);
          throw new Error(errorMessage);
        }
      }

      // Ensure count is properly defined
      const accountCount = options.count || 0;

      console.log(`=== STARTING ACCOUNT GENERATION ===`);
      console.log(
        `Count: ${accountCount}, Batch mode: ${effectiveUseBatch}, Demo mode: ${!!config.demoMode}, Batch size: ${batchSize}`
      );
      console.log(`Target Liferay URL: ${config.liferayUrl}`);

      // Input validation
      if (!config.liferayUrl || !config.clientId || !config.clientSecret) {
        throw new Error('Missing required Liferay configuration');
      }

      if (config.count <= 0) {
        throw new Error('Account count must be greater than 0');
      }

      // Validate pollingDelay
      if (config.pollingDelay === undefined || config.pollingDelay === null) {
        throw new Error('pollingDelay is required');
      }

      const pollingDelay = parseInt(config.pollingDelay);
      if (isNaN(pollingDelay) || pollingDelay < 5 || pollingDelay > 600) {
        throw new Error('pollingDelay must be between 5 and 600 seconds');
      }


      let accountDataList;
      if (config.demoMode || options.demoMode) {
        console.log(`Demo mode: Generating ${accountCount} mock accounts`);
        const mockGen = new MockDataGenerator();
        accountDataList = mockGen.generateAccountData(accountCount);
        console.log(
          `Demo: Generated ${accountDataList.length} mock account data entries`
        );
      } else {
        console.log(
          `AI mode: Generating ${accountCount} accounts using ${config.aiModel}`
        );
        accountDataList = await this.aiService.generateAccountData(
          accountCount,
          config.aiModel || 'gpt-4o'
        );
        console.log(
          `AI: Generated ${accountDataList.length} account data entries`
        );
      }

      if (effectiveUseBatch) {
        console.log(`Using batch operations for ${accountDataList.length} accounts`);
        // Create callback URL for batch status updates
        const callbackUrl = config.microserviceUrl
          ? `${config.microserviceUrl}/api/batch-callback`
          : null;

        return await this.createAccountsBatch(
          config,
          accountDataList,
          callbackUrl
        );
      } else {
        console.log(`Using individual operations for ${accountDataList.length} accounts`);
        return await this.generateAccountsIndividually(config, accountDataList);
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

  async generateAccountsIndividually(config, accountDataList) {
    const generatedAccounts = [];
    const errors = [];

    // Generate accounts using the same mechanism for both demo and live modes
    for (let i = 0; i < accountDataList.length; i++) {
      const accountData = accountDataList[i];
      const correlationId = uuidv4();

      try {
        // Both modes use the same Liferay API mechanism
        const createdAccount = await this.createSingleAccount(
          config,
          accountData
        );
        generatedAccounts.push(createdAccount);

        logger.info('Account created successfully', {
          correlationId: correlationId,
          operation: 'create-account',
          accountId: createdAccount.id,
          accountName: createdAccount.name,
          mode: config.demoMode ? 'demo' : 'live',
        });
      } catch (error) {
        logger.error('Account creation failed', {
          correlationId: correlationId,
          operation: 'create-account',
          error: error.message,
          accountIndex: i,
          mode: config.demoMode ? 'demo' : 'live',
        });

        errors.push({
          index: i,
          error: error.message,
          accountData: accountData,
        });
      }
    }

    logger.info('Account generation completed', {
      correlationId: uuidv4(),
      operation: 'generate-accounts',
      created: generatedAccounts.length,
      errors: errors.length,
      mode: config.demoMode ? 'demo' : 'live',
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
        correlationId: uuidv4(),
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

      // Create batch with callback URL
      // const callbackUrl = config.microserviceUrl
      //   ? `${config.microserviceUrl}/api/batch-callback`
      //   : null;

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
          createdAt: new Date().toISOString()
        },
        1800000 // 30 minutes
      );

      const pollingDelay = parseInt(config.pollingDelay); // Assuming pollingDelay is already validated in generateAccounts
      const pollInterval = pollingDelay * 1000; // Convert to milliseconds
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
            error: error.message
          });
        }
      });

      logger.info('Batch account creation initiated', {
        correlationId: uuidv4(),
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
        correlationId: uuidv4(),
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
        correlationId: uuidv4(),
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
        correlationId: uuidv4(),
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
        correlationId: uuidv4(),
        operation: 'create-account',
        accountName: liferayAccount.name,
        hasEmail: !!accountData.emailAddress,
      });

      const createdAccount = await liferayService.createAccount(
        config,
        liferayAccount
      );

      logger.info('Account created successfully', {
        correlationId: uuidv4(),
        operation: 'create-account',
        accountId: createdAccount.id,
        accountName: createdAccount.name,
      });

      return createdAccount;
    } catch (error) {
      logger.error('Failed to create account', {
        correlationId: uuidv4(),
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
      totalCount: results.totalCount
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
            error: item.error || item.message || 'Unknown error'
          });
        }
      });
    } else {
      // If content is not an array, assume all were successful if status is COMPLETED
      successCount = results.processedCount || results.totalCount || 0;
    }

    // Send WebSocket update
    if (this.websocketService) {
      this.websocketService.broadcastBatchUpdate({
        type: failureCount > 0 ? 'batch_completed_with_errors' : 'batch_completed', // Changed type for clarity on errors
        entityType: 'accounts', // Assuming entityType is 'accounts'
        batchId: results.batchId,
        successCount,
        failureCount,
        details: failureCount > 0 ? { failures } : null
      });
    }
  }
}

module.exports = new AccountGenerator();