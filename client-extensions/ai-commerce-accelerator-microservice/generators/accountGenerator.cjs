const { ERC_PREFIX } = require('../utils/constants.cjs');
const { createERC, randomString, toTitleCase } = require('../utils/misc.cjs');
const BATCH_STEP_HANDLERS = require('../services/batch-steps/index.cjs');

class AccountGenerator {
  constructor(ctx) {
    this.ctx = ctx;

    this.steps = {
      'load-countries': this._runLoadCountriesStep.bind(this),
      'account-data-generation': this._runAccountDataGenerationStep.bind(this),
      'accounts': this._runAccountCreationStep.bind(this),
      'postal-addresses': this._runAddressCreationStep.bind(this),
      'set-billing-and-shipping-addresses': this._runSetBillingAndShippingAddressesStep.bind(this),
    };
  }

  async _runLoadCountriesStep(sessionId, session) {
    const { logger, liferay, persistence } = this.ctx;
    const { config } = session.context;

    logger.info('Starting load countries step', { sessionId });

    let countries = [];
    try {
      countries = await liferay.getCountries(config);
      logger.info('Fetched countries', { sessionId, count: countries.length });
    } catch (error) {
      logger.error('Failed to fetch countries in load-countries step', { sessionId, error: error.message, stack: error.stack });
      await persistence.updateSession(sessionId, { status: 'FAILED' });
      return;
    }

    await persistence.updateSessionContext(sessionId, {
      ...session.context,
      countries,
    });

    await persistence.createBatch({
      erc: createERC(ERC_PREFIX.BATCH),
      sessionId,
      stepKey: 'load-countries',
      status: 'COMPLETED',
    });

    logger.info('Load countries step complete', {
      sessionId,
      countriesCount: countries.length,
    });

    await this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );
  }

  async generate(config, options) {
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

  async _runAccountDataGenerationStep(sessionId, session) {
    const { logger, ai, mockData, persistence } = this.ctx;
    const { config, options, countries } = session.context;

    logger.info('Starting account data generation step', { sessionId });

    this.validateConfig(config);
    await this.validateOptions(config, options);

    let accountDataList;
    if (options.demoMode) {
      accountDataList = await mockData.generateAccountData(
        options.accountCount,
        config
      );
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
      status: 'COMPLETED',
    });

    logger.info('Account data generation step complete', {
      sessionId,
      accountCount: accountsToCreate.length,
      addressCount: addressesToCreate.length,
    });

    await this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );
  }

  async _runAccountCreationStep(sessionId, session) {
    const { logger, persistence, liferay } = this.ctx;
    const { config, accountsToCreate } = session.context;

    logger.info('Starting account creation step', { sessionId });

    if (!accountsToCreate || accountsToCreate.length === 0) {
      logger.info('No accounts to create. Skipping step.', { sessionId });
      return;
    }

    const batchERC = createERC(ERC_PREFIX.BATCH_GENERATION);

    await persistence.createBatch({
      erc: batchERC,
      sessionId,
      stepKey: 'accounts',
      status: 'PREPARED',
    });

    await liferay.createAccountsBatch(config, accountsToCreate, {
      externalReferenceCode: batchERC,
      sessionId,
    });

    await persistence.updateBatch(batchERC, { status: 'SUBMITTED' });

    logger.info('Account creation batch submitted.', {
      sessionId,
      batchERC,
      count: accountsToCreate.length,
    });
  }

  async _runAddressCreationStep(sessionId, session) {
    await this.startPostalAddressesBatch({
      sessionId,
      session: session.context,
      correlationId: session.context.config.correlationId,
    });
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
    const { logger, persistence, liferay } = this.ctx;
    const { config, addressesToCreate } = session;

    logger.info('Starting postal address creation step', { sessionId });

    if (!addressesToCreate || addressesToCreate.length === 0) {
      logger.info('No addresses to create. Skipping step.', { sessionId });
      return;
    }

    const accounts = await liferay.getAccounts(config);

    logger.debug(`Found ${accounts.length} accounts`);
    logger.trace(`Accounts: ${JSON.stringify(accounts, null, 2)}`);

    logger.debug(`Found ${addressesToCreate.length} addresses to create`);
    logger.trace(
      `Addresses to create: ${JSON.stringify(addressesToCreate, null, 2)}`
    );

    for (const account of accounts) {
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

        await persistence.createBatch({
          erc: batchERC,
          sessionId,
          stepKey: 'postal-addresses',
          status: 'PREPARED',
        });

        await liferay.createAccountAddressBatch(
          config,
          account.id,
          addressesForAccount,
          {
            externalReferenceCode: batchERC,
            sessionId,
          }
        );

        await persistence.updateBatch(batchERC, { status: 'SUBMITTED' });

        logger.info('Address creation batch submitted.', {
          sessionId,
          batchERC,
          accountId: account.id,
          count: addressesForAccount.length,
        });
      } else{
        logger.debug(`Unable to find addresses for ${account.externalReferenceCode}`)
      }
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

  async _runSetBillingAndShippingAddressesStep(sessionId, session) {
    const { logger, persistence, liferay } = this.ctx;
    const { config, accountsToCreate, addressesToCreate } = session.context;

    logger.info('Starting set billing and shipping addresses step', { sessionId });
    if ((!accountsToCreate || accountsToCreate.length === 0) && (!addressesToCreate || addressesToCreate.length === 0)) {
      logger.info('No accounts or addresses to set. Skipping step.', { sessionId });
      return;
    }

    for (const account of accountsToCreate) {
      const shippingAddress = addressesToCreate.find((address) => address.accountERC === account.externalReferenceCode && address.addressType === 'shipping');
      let shippingAddressId;
      if (shippingAddress) {
        shippingAddressId = await liferay.getPostalAddressByERC(config, shippingAddress.externalReferenceCode);
      }

      const billingAddress = addressesToCreate.find((address) => address.accountERC === account.externalReferenceCode && address.addressType === 'billing');
      let billingAddressId;
      if (billingAddress) {
        billingAddressId = await liferay.getPostalAddressByERC(config, billingAddress.externalReferenceCode)
      }

      if (shippingAddressId || billingAddressId) {
        await liferay.setBillingAndShippingAddresses(config, account.id, shippingAddressId, billingAddressId);
        logger.info('Billing and shipping addresses set.', {
          sessionId,
          accountId: account.id,
          shippingAddressId,
          billingAddressId,
        });
      } else { 
        logger.debug(`No shipping or billing addresses found for account ${account.externalReferenceCode}`)
      }
    }

    logger.info('Set billing and shipping addresses step complete', { sessionId });
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
