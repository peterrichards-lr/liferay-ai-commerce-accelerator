const { ERC_PREFIX } = require('../utils/constants.cjs');
const { createERC, randomString } = require('../utils/misc.cjs');
const BATCH_STEP_HANDLERS = require('../services/batch-steps/index.cjs');

class AccountGenerator {
  constructor(ctx) {
    this.ctx = ctx;
  }

  createOnSessionComplete() {
    // This hook is for final session completion logic, not for starting next steps
    return null;
  }

  async startPostalAddressesBatch({ sessionId, session, correlationId }) {
    const { logger, persistence, liferay } = this.ctx;
    const { config, addressesToCreate } = session;

    try {
      logger.info('Starting postal addresses batch processing', {
        sessionId,
        correlationId,
        nextStep: 'postal-addresses',
      });

      const resolvedAccounts = await BATCH_STEP_HANDLERS.resolveEntities(this.ctx, {
        ...session,
        entityTypeToResolve: 'accounts',
      });
      
      const addressesWithAccountIds = addressesToCreate.map(address => {
        const account = resolvedAccounts.find(acc => acc.externalReferenceCode === address.accountERC);
        if (account) {
          return { ...address, accountId: account.id };
        }
        return null;
      }).filter(Boolean);

      if (addressesWithAccountIds.length > 0) {
        const batchERC = createERC(ERC_PREFIX.BATCH_GENERATION);

        await persistence.createBatch({
          erc: batchERC,
          sessionId,
          stepKey: 'postal-addresses',
          status: 'PREPARED',
        });

        const firstAccountId = addressesWithAccountIds[0].accountId;
        await liferay.createAccountAddressBatch(
          config,
          firstAccountId,
          addressesWithAccountIds.map(addr => {
            const { accountId, accountERC, ...rest } = addr;
            return rest;
          }),
          { externalReferenceCode: batchERC, sessionId }
        );

        await persistence.updateBatch(batchERC, { status: 'SUBMITTED' });
        logger.info('Postal addresses batch submitted', { batchERC, sessionId, count: addressesWithAccountIds.length });
      } else {
        logger.info('No postal addresses to create for this session.', { sessionId, correlationId });
        // Manually complete the step if no addresses were to be created
        await persistence.createBatch({
          erc: createERC(ERC_PREFIX.BATCH), // Generic ERC for an empty step
          sessionId,
          step_key: 'postal-addresses',
          status: 'COMPLETED',
        });
        logger.info('Manually marked postal-addresses step as COMPLETED due to no addresses to create.', { sessionId });
      }
    } catch (error) {
      logger.error('Error in startPostalAddressesBatch', {
        sessionId,
        correlationId,
        error: error.message,
        stack: error.stack,
      });
      await persistence.updateSession(sessionId, { status: 'FAILED' });
    }
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
      persistence,
      liferay,
    } = this.ctx;
    const correlationId = config.correlationId;

    logger.info('Starting account generation process', {
      correlationId,
      operation: 'accounts/generate:start',
      accountCount: options.accountCount || 0,
      demoMode: options.demoMode,
    });

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

      const accountsToCreate = [];
      const addressesToCreate = [];

      for (const raw of accountDataList) {
        const account = { ...raw };

        account.accountContactInformation = account.accountContactInformation || {};

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
        
        account.accountContactInformation.postalAddresses = account.accountContactInformation.postalAddresses || [];
        if(account.headOfficeAddress) {
            account.accountContactInformation.postalAddresses.push(account.headOfficeAddress);
            delete account.headOfficeAddress;
        }

        const billingAddress = account.billingAddress || this._generateAddress('billing');
        const shippingAddress = account.shippingAddress || this._generateAddress('shipping');

        addressesToCreate.push({
          ...billingAddress,
          accountERC: account.externalReferenceCode,
        });

        addressesToCreate.push({
          ...shippingAddress,
          accountERC: account.externalReferenceCode,
        });

        delete account.billingAddress;
        delete account.shippingAddress;
        
        accountsToCreate.push(account);
      }

      const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);
      const steps = [
        { name: 'accounts', type: 'sync' },
        { name: 'postal-addresses', type: 'sync' }
      ];

      await persistence.createSession({
        sessionId,
        flowType: 'accounts',
        status: 'STARTED',
        context: {
          config,
          options,
          accounts: accountsToCreate,
          addressesToCreate,
          steps,
        },
        currentSteps: [{ name: 'accounts', type: 'sync' }],
      });

      const batchERC = createERC(ERC_PREFIX.BATCH_GENERATION);
      
      persistence.createBatch({
        erc: batchERC,
        sessionId,
        stepKey: 'accounts',
        status: 'PREPARED',
      });
      
      await liferay.createAccountsBatch(config, accountsToCreate, { externalReferenceCode: batchERC, sessionId });
      
      persistence.updateBatch(batchERC, { status: 'SUBMITTED' });

      return {
        sessionId,
        message: 'Account generation process started.',
      };

    } catch (error) {
      logger.error('Account generation failed', {
        correlationId,
        operation: 'accounts/generate:error',
        error: error.message,
      });
      throw error;
    }
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