const { ERC_PREFIX } = require('../utils/constants.cjs');
const {
  createERC,
  processWithRetry,
  randomString,
  toTitleCase,
} = require('../utils/misc.cjs');
const BATCH_STEP_HANDLERS = require('../services/batch/batch-steps/index.cjs');

class AccountGenerator {
  constructor(ctx) {
    this.ctx = ctx;

    this.steps = {
      'load-countries': this._runLoadCountriesStep.bind(this),
      'account-data-generation': this._runAccountDataGenerationStep.bind(this),
      'accounts': this._runAccountCreationStep.bind(this),
      'resolve-account-ids': this._runResolveAccountIdsStep.bind(this),
      'postal-addresses': this._runAddressCreationStep.bind(this),
      'set-billing-and-shipping-addresses': this._runSetBillingAndShippingAddressesStep.bind(this),
    };
  }

  async _runLoadCountriesStep(sessionId) {
    const { logger, liferay, persistence, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config } = session.context;

    logger.info('Starting load countries step', { sessionId });

    let countries = [];
    try {
      countries = await liferay.getCountries(config);
      logger.info('Fetched countries', { sessionId, count: countries.length });
      
      await persistence.updateSessionContext(sessionId, {
        ...session.context,
        countries,
      });

      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'load-countries',
        status: 'SYNCHRONOUS',
      });

      logger.info('Load countries step complete', {
        sessionId,
        countriesCount: countries.length,
      });
    } catch (error) {
      logger.error('Failed to fetch countries in load-countries step', { 
        sessionId, 
        error: error.message 
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'load-countries',
        status: 'FAILED',
      });
    }
  }

  async generateAccounts(config, options) {
    const { logger, persistence, batchCallback } = this.ctx;
    const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

    const steps = Object.keys(this.steps).map((name) => ({
      name,
      type: 'sync',
    }));

    await persistence.createSession({
      sessionId,
      flowType: 'accounts',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: {
        config,
        options,
        steps,
      },
    });

    batchCallback._checkSessionCompletion(sessionId, config.correlationId);

    logger.info('Account generation workflow started', {
      sessionId,
      steps: steps.map((s) => s.name),
    });

    return {
      sessionId,
      message: 'Account generation workflow started.',
    };
  }

  async _runAccountDataGenerationStep(sessionId) {
    const { logger, ai, mockData, persistence, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, countries } = session.context;

    logger.info('Starting account data generation step', { sessionId });

    try {
      this.validateConfig(config);
      await this.validateOptions(config, options);

      let accountDataList;
      if (options.demoMode) {
        accountDataList = await mockData.generateAccountData(
          options.accountCount,
          config,
          options.categories
        );
      } else {
        accountDataList = await ai.generateAccountData(
          options.accountCount,
          config,
          config.aiModel,
          options.categories
        );
      }

      const accountsToCreate = [];
      const addressesToCreate = [];

              for (const raw of accountDataList) {
                const account = { ...raw };
                if (!account.externalReferenceCode) {
                  account.externalReferenceCode = createERC(ERC_PREFIX.ACCOUNT);
                }
                account.accountContactInformation =          account.accountContactInformation || {};

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
        if (account.domains) delete account.domains;
        if (account.accountContactInformation?.domains) {
          delete account.accountContactInformation.domains;
        }

        account.accountContactInformation.postalAddresses =
          account.accountContactInformation.postalAddresses || [];
        if (account.headOfficeAddress) {
          account.accountContactInformation.postalAddresses.push(
            await this._generateAddress(
              'head-office',
              config,
              account.headOfficeAddress,
              countries
            )
          );
          delete account.headOfficeAddress;
        }

        const billingAddress = await this._generateAddress(
          'billing',
          config,
          account.billingAddress,
          countries
        );
        const shippingAddress = await this._generateAddress(
          'shipping',
          config,
          account.shippingAddress,
          countries
        );

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

      await persistence.updateSessionContext(sessionId, {
        ...session.context,
        accountsToCreate,
        addressesToCreate,
      });

      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'account-data-generation',
        status: 'SYNCHRONOUS',
      });

      logger.info('Account data generation step complete', {
        sessionId,
        accountCount: accountsToCreate.length,
        addressCount: addressesToCreate.length,
      });
    } catch (error) {
      logger.error('Failed execution of account-data-generation step', {
        sessionId,
        error: error.message,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'account-data-generation',
        status: 'FAILED',
      });
    }
  }

  async _runAccountCreationStep(sessionId) {
    const { logger, persistence, liferay, progress } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, accountsToCreate } = session.context;

    logger.info('Starting account creation step', { sessionId });

    try {
      if (!accountsToCreate || accountsToCreate.length === 0) {
        logger.info('No accounts to create. Skipping step.', { sessionId });
        await persistence.createBatch({
          erc: createERC(ERC_PREFIX.BATCH),
          sessionId,
          stepKey: 'accounts',
          status: 'BYPASSED',
        });
        return;
      }

      const batchERC = createERC(ERC_PREFIX.BATCH_GENERATION);

      if (options.dryRun) {
          logger.info('DRY RUN: Skipping account creation batch submission.');
          logger.info({
              dryRunData: {
                  step: 'accounts',
                  count: accountsToCreate.length,
                  payload: accountsToCreate,
              },
          });
          await persistence.createBatch({
              erc: batchERC,
              sessionId,
              stepKey: 'accounts',
              status: 'SYNCHRONOUS',
          });
          return; 
      }

      await persistence.createBatch({
        erc: batchERC,
        sessionId,
        stepKey: 'accounts',
        status: 'PREPARED',
      });

      const submission = await liferay.createAccountsBatch(config, accountsToCreate, {
        externalReferenceCode: batchERC,
        sessionId,
      });

      await persistence.updateBatch(batchERC, { 
        status: 'SUBMITTED',
        downstreamBatchId: submission.batchId,
        totalCount: accountsToCreate.length
      });

      progress.batchStarted({
        sessionId,
        batchERC,
        batchId: submission.batchId,
        totalItems: accountsToCreate.length,
        entityType: 'accounts',
        operation: 'generate',
        correlationId: config.correlationId,
      });

      logger.info('Account creation batch submitted.', {
        sessionId,
        batchERC,
        count: accountsToCreate.length,
      });
    } catch (error) {
      logger.error('Failed execution of accounts creation step', {
        sessionId,
        error: error.message,
      });
      // Try to find if we created a batch record and mark it failed, 
      // otherwise create a generic failure batch for this step.
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'accounts',
        status: 'FAILED',
      });
    }
  }

  async _runResolveAccountIdsStep(sessionId) {
    const { logger, liferay, persistence } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, accountsToCreate } = session.context;

    if (!accountsToCreate || accountsToCreate.length === 0) {
      logger.info('No accounts to resolve IDs for. Skipping step.', { sessionId });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-account-ids',
        status: 'BYPASSED',
      });
      return;
    }

    logger.info(`Resolving real numeric IDs for ${accountsToCreate.length} accounts via GraphQL/ERC...`, { sessionId });

    try {
      const ercs = accountsToCreate.map(a => a.externalReferenceCode);
      const resolvedItems = await liferay.resolveByERCsWithRetry(
        config,
        ercs,
        (cfg, e) => liferay.getAccountsByERC(cfg, e, ['id', 'externalReferenceCode', 'name']),
        { label: 'accounts' }
      );

      const ercToIdMap = new Map();
      (resolvedItems || []).forEach(item => {
        if (item) {
          ercToIdMap.set(item.externalReferenceCode, item.id);
        }
      });

      const updatedAccounts = accountsToCreate.map(a => ({
        ...a,
        id: ercToIdMap.get(a.externalReferenceCode) || a.id
      }));

      await persistence.updateSessionContext(sessionId, {
        ...session.context,
        accountsToCreate: updatedAccounts
      });

      logger.info('Successfully resolved account IDs.', { sessionId, resolvedCount: ercToIdMap.size });

      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-account-ids',
        status: 'SYNCHRONOUS',
      });

    } catch (error) {
      logger.error('Failed to resolve account IDs', { sessionId, error: error.message });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-account-ids',
        status: 'FAILED',
      });
    }
  }

  async _runAddressCreationStep(sessionId) {
    const { logger, persistence } = this.ctx;
    const session = await persistence.getSession(sessionId);
    try {
      await this.startPostalAddressesBatch({
        sessionId,
        session: session.context,
        correlationId: session.context.config.correlationId,
      });
    } catch (error) {
      logger.error('Failed execution of postal-addresses step', {
        sessionId,
        error: error.message,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'postal-addresses',
        status: 'FAILED',
      });
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

  async startPostalAddressesBatch({ sessionId, session, correlationId }) {
    const { logger, persistence, liferay, progress } = this.ctx;
    const { config, options, accountsToCreate, addressesToCreate } = session;

    logger.info('Starting postal address creation step', { sessionId });

    if (!addressesToCreate || addressesToCreate.length === 0) {
      logger.info('No addresses to create. Skipping step.', { sessionId });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'postal-addresses',
        status: 'BYPASSED',
      });
      return;
    }

    if (!accountsToCreate || accountsToCreate.length === 0) {
      logger.warn('No accounts available in context to associate addresses with.', { sessionId });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'postal-addresses',
        status: 'BYPASSED',
      });
      return;
    }

    logger.debug(`Processing addresses for ${accountsToCreate.length} accounts from context`);

    let startedAny = false;

    for (const account of accountsToCreate) {
      if (!account.id) {
        logger.warn(`Account with ERC ${account.externalReferenceCode} has no ID. Skipping address creation.`, { sessionId });
        continue;
      }

      const addressesForAccount = addressesToCreate
        .filter(
          (address) => address.accountERC === account.externalReferenceCode
        )
        .map((address) => {
          const { accountERC, ...rest } = address;
          return rest;
        });

      if (addressesForAccount.length > 0) {
        const batchERC = createERC(ERC_PREFIX.BATCH_GENERATION);

        if (options.dryRun) {
            logger.info('DRY RUN: Skipping address creation', {
              accountERC: account.externalReferenceCode,
            });
            await persistence.createBatch({
                erc: batchERC,
                sessionId,
                stepKey: 'postal-addresses',
                status: 'SYNCHRONOUS',
            });
            startedAny = true;
            continue;
        }

        await persistence.createBatch({
          erc: batchERC,
          sessionId,
          stepKey: 'postal-addresses',
          status: 'PREPARED',
        });

        const submission = await liferay.createAccountAddressBatch(
          config,
          account.id,
          addressesForAccount,
          {
            externalReferenceCode: batchERC,
            sessionId,
          }
        );

        await persistence.updateBatch(batchERC, { 
          status: 'SUBMITTED',
          downstreamBatchId: submission.batchId,
          totalCount: addressesForAccount.length
        });

        progress.batchStarted({
          sessionId,
          batchERC,
          batchId: submission.batchId,
          totalItems: addressesForAccount.length,
          entityType: 'accounts',
          operation: 'generate',
          correlationId: correlationId,
        });

        logger.info('Address creation batch submitted.', {
          sessionId,
          batchERC,
          accountId: account.id,
          count: addressesForAccount.length,
        });
        startedAny = true;
      } else {
        logger.debug('No addresses to create for account', {
          accountERC: account.externalReferenceCode
        });
      }
    }

    if (!startedAny) {
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'postal-addresses',
        status: 'SYNCHRONOUS',
      });
    }
  }

  generateTaxId() {
    const firstTwo = Math.floor(Math.random() * 99) + 1;
    const lastSeven = Math.floor(Math.random() * 8999999) + 1000000;
    return `${firstTwo.toString().padStart(2, '0')}-${lastSeven}`;
  }

  async _generateAddress(addressType, config, address, countries) {
    const { liferay } = this.ctx;
    const streetNumber = Math.floor(Math.random() * 999) + 1;
    const streetName = randomString(8);
    const streetType = ['Street', 'Avenue', 'Road', 'Lane'][
      Math.floor(Math.random() * 4)
    ];

    const country = countries[Math.floor(Math.random() * countries.length)];
    const regions = await liferay.getCountryRegions(config, country.id);

    let region;
    if (regions.length > 0) {
      region = regions[Math.floor(Math.random() * regions.length)];
    }

    return {
      name: `${toTitleCase(addressType).replace(/-/g, ' ')} Address`,
      streetAddressLine1: `${streetNumber} ${streetName} ${streetType}`,
      addressLocality: address.addressLocality,
      addressRegion: region?.name,
      postalCode: address.postalCode,
      addressCountry: country?.title_i18n?.en_US,
      addressType,
      primary: false,
      externalReferenceCode: createERC(ERC_PREFIX.ADDRESS),
    };
  }

  async _runSetBillingAndShippingAddressesStep(sessionId) {
    const { logger, liferay, persistence, batchCallback } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, accountsToCreate, addressesToCreate } = session.context;

    logger.info('Starting set billing and shipping addresses step', { sessionId });
    
    try {
      if ((!accountsToCreate || accountsToCreate.length === 0) && (!addressesToCreate || addressesToCreate.length === 0)) {
        logger.info('No accounts or addresses to set. Skipping step.', { sessionId });
        await persistence.createBatch({
          erc: createERC(ERC_PREFIX.BATCH),
          sessionId,
          stepKey: 'set-billing-and-shipping-addresses',
          status: 'BYPASSED',
        });
        return;
      }

      if (options.dryRun) {
          logger.info('DRY RUN: Skipping set billing and shipping addresses step.');
          await persistence.createBatch({
              erc: createERC(ERC_PREFIX.BATCH),
              sessionId,
              stepKey: 'set-billing-and-shipping-addresses',
              status: 'BYPASSED',
          });
          return;
      }

      const addressErcs = addressesToCreate.map(address => address.externalReferenceCode);
      const accountErcs = accountsToCreate.map(account => account.externalReferenceCode);
      
      const [liferayAddresses, liferayAccounts] = await Promise.all([
        liferay.resolveByERCsWithRetry(
          config,
          addressErcs,
          (cfg, e) => liferay.getPostalAddressesByERC(cfg, e, ['id', 'externalReferenceCode']),
          { label: 'postal addresses' }
        ),
        liferay.resolveByERCsWithRetry(
          config,
          accountErcs,
          (cfg, e) => liferay.getAccountsByERC(cfg, e, ['id', 'externalReferenceCode']),
          { label: 'accounts' }
        )
      ]);

      const addressMap = new Map();
      (liferayAddresses || []).forEach(address => {
        if (address && address.externalReferenceCode) {
          addressMap.set(address.externalReferenceCode, address);
        }
      });

      const accountMap = new Map();
      (liferayAccounts || []).forEach(account => {
        if (account && account.externalReferenceCode) {
          accountMap.set(account.externalReferenceCode, account);
        }
      });

      for (const account of accountsToCreate) {
        try {
          const liferayAccount = accountMap.get(account.externalReferenceCode);

          if (!liferayAccount) {
              logger.warn(`Could not find created account for ERC ${account.externalReferenceCode || 'N/A'}. Skipping address association.`, { sessionId });
              continue;
          }

          const shippingAddressErc = addressesToCreate.find(
            (address) =>
              address.accountERC === account.externalReferenceCode &&
              address.addressType === 'shipping'
          )?.externalReferenceCode;

          const liferayShippingAddress = shippingAddressErc ? addressMap.get(shippingAddressErc) : undefined;

          const billingAddressErc = addressesToCreate.find(
            (address) =>
              address.accountERC === account.externalReferenceCode &&
              address.addressType === 'billing'
          )?.externalReferenceCode;
          
          const liferayBillingAddress = billingAddressErc ? addressMap.get(billingAddressErc) : undefined;

          if (liferayShippingAddress || liferayBillingAddress) {
            await liferay.setBillingAndShippingAddresses(
              config,
              liferayAccount.id,
              liferayShippingAddress?.id,
              liferayBillingAddress?.id
            );
          }
        } catch (error) {
          logger.error(`Failed to set addresses for account ${account.externalReferenceCode}`, { error: error.message, sessionId });
        }
      }

      logger.info('Set billing and shipping addresses step complete', { sessionId });

      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'set-billing-and-shipping-addresses',
        status: 'SYNCHRONOUS',
      });
    } catch (error) {
      logger.error('Failed execution of set-billing-and-shipping-addresses step', {
        sessionId,
        error: error.message,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'set-billing-and-shipping-addresses',
        status: 'FAILED',
      });
    }
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
