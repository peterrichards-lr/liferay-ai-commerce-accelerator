const { ERC_PREFIX } = require('../utils/constants.cjs');
const {
  createERC,
  processWithRetry,
  randomString,
  toTitleCase,
  delay,
} = require('../utils/misc.cjs');
const BATCH_STEP_HANDLERS = require('../services/batch/batch-steps/index.cjs');

class AccountGenerator {
  constructor(ctx) {
    this.ctx = ctx;

    this.steps = {
      'load-countries': this._runLoadCountriesStep.bind(this),
      'account-data-generation': this._runAccountDataGenerationStep.bind(this),
      accounts: this._runAccountCreationStep.bind(this),
      'resolve-account-ids': this._runResolveAccountIdsStep.bind(this),
      'postal-addresses': this._runAddressCreationStep.bind(this),
      'set-billing-and-shipping-addresses':
        this._runSetBillingAndShippingAddressesStep.bind(this),
    };
  }

  async generateAccounts(config, options) {
    const { logger, persistence, batchCallback } = this.ctx;
    const sessionId = options.sessionId || createERC(ERC_PREFIX.BATCH_SESSION);
    options.sessionId = sessionId;

    const steps = [
      { name: 'load-countries', type: 'sync' },
      { name: 'account-data-generation', type: 'sync' },
      { name: 'accounts', type: 'sync' },
      { name: 'resolve-account-ids', type: 'sync' },
      { name: 'postal-addresses', type: 'sync' },
      { name: 'set-billing-and-shipping-addresses', type: 'sync' },
    ];

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

    return {
      sessionId,
      message: 'Account generation workflow started.',
    };
  }

  async _runLoadCountriesStep(sessionId) {
    const { logger, liferay, persistence } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config } = session.context;

    logger.info('Starting load countries step', {
      sessionId,
      correlationId: session.correlationId,
    });

    let countries = [];
    try {
      countries = await liferay.getCountries(config);

      logger.debug('Fetched countries', {
        sessionId,
        correlationId: session.correlationId,
        count: countries.length,
      });

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
      logger.error(`Failed to load countries: ${error.message}`, {
        sessionId,
        error,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'load-countries',
        status: 'FAILED',
      });
    }
  }

  async _runAccountDataGenerationStep(sessionId) {
    const { logger, ai, mockData, persistence } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, countries } = session.context;

    logger.info('Starting account data generation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      this.validateConfig(config);
      await this.validateOptions(config, options);

      let accountDataList;
      if (options.demoMode) {
        accountDataList = await mockData.generateAccountData(
          options.accountCount,
          config,
          options.categories,
          options
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

        // Ensure accountContactInformation exists but clean postalAddresses
        account.accountContactInformation =
          account.accountContactInformation || {};
        if (account.accountContactInformation.postalAddresses) {
          delete account.accountContactInformation.postalAddresses;
        }

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

        // Capture and remove address fields from the account creation payload
        const rawHeadOffice = account.headOfficeAddress;
        const rawBilling = account.billingAddress;
        const rawShipping = account.shippingAddress;

        delete account.headOfficeAddress;
        delete account.billingAddress;
        delete account.shippingAddress;

        // Generate addresses for separate batch creation
        if (rawHeadOffice) {
          addressesToCreate.push({
            ...(await this._generateAddress(
              'head-office',
              config,
              rawHeadOffice,
              countries
            )),
            accountERC: account.externalReferenceCode,
          });
        }

        if (rawBilling) {
          addressesToCreate.push({
            ...(await this._generateAddress(
              'billing',
              config,
              rawBilling,
              countries
            )),
            accountERC: account.externalReferenceCode,
          });
        }

        if (rawShipping) {
          addressesToCreate.push({
            ...(await this._generateAddress(
              'shipping',
              config,
              rawShipping,
              countries
            )),
            accountERC: account.externalReferenceCode,
          });
        }

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
        correlationId: session.correlationId,
        accountCount: accountsToCreate.length,
        addressCount: addressesToCreate.length,
      });
    } catch (error) {
      logger.error('Failed execution of account-data-generation step', {
        sessionId,
        correlationId: session.correlationId,
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
    const { logger, persistence, liferay } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, accountsToCreate } = session.context;

    logger.info('Starting account creation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      if (!accountsToCreate || accountsToCreate.length === 0) {
        logger.info('No accounts to create. Skipping step.', {
          sessionId,
          correlationId: session.correlationId,
        });
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
        await persistence.createBatch({
          erc: batchERC,
          sessionId,
          stepKey: 'accounts',
          status: 'SYNCHRONOUS',
          processedCount: accountsToCreate.length,
          totalCount: accountsToCreate.length,
        });
      } else {
        await persistence.createBatch({
          erc: batchERC,
          sessionId,
          stepKey: 'accounts',
          status: 'prepared',
        });

        await liferay.createAccountsBatch(config, accountsToCreate, {
          externalReferenceCode: batchERC,
          sessionId,
        });
      }
    } catch (error) {
      logger.error('Failed to start account creation step', {
        sessionId,
        error: error.message,
      });
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
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-account-ids',
        status: 'BYPASSED',
      });
      return;
    }

    logger.info('Starting account ID resolution step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      const ercs = accountsToCreate.map((a) => a.externalReferenceCode);
      const results = await liferay.resolveByERCsWithRetry(
        config,
        ercs,
        (cfg, e) =>
          liferay.getAccountsByERC(cfg, e, ['id', 'externalReferenceCode']),
        { label: 'accounts' }
      );

      const ercToIdMap = new Map();
      results.forEach((item) => {
        if (item.externalReferenceCode && item.id) {
          ercToIdMap.set(item.externalReferenceCode, item.id);
        }
      });

      const updatedAccounts = accountsToCreate.map((a) => ({
        ...a,
        id: ercToIdMap.get(a.externalReferenceCode),
      }));

      await persistence.updateSessionContext(sessionId, {
        ...session.context,
        accountsToCreate: updatedAccounts,
      });

      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-account-ids',
        status: 'SYNCHRONOUS',
        processedCount: ercToIdMap.size,
        totalCount: ercs.length,
      });

      logger.info('Account ID resolution step complete', {
        sessionId,
        resolved: ercToIdMap.size,
        total: ercs.length,
      });
    } catch (error) {
      logger.error('Failed to resolve account IDs', {
        sessionId,
        error: error.message,
      });
      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'resolve-account-ids',
        status: 'FAILED',
      });
    }
  }

  async _runAddressCreationStep(sessionId) {
    const { logger, persistence, liferay } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, accountsToCreate, addressesToCreate } =
      session.context;

    logger.info('Starting postal address creation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      if (!addressesToCreate || addressesToCreate.length === 0) {
        logger.info('No addresses to create. Skipping step.', {
          sessionId,
          correlationId: session.correlationId,
        });
        await persistence.createBatch({
          erc: createERC(ERC_PREFIX.BATCH),
          sessionId,
          stepKey: 'postal-addresses',
          status: 'BYPASSED',
        });
        return;
      }

      // Map account IDs to addresses
      const accountERCtoId = new Map();
      accountsToCreate.forEach((a) => {
        if (a.id) accountERCtoId.set(a.externalReferenceCode, a.id);
      });

      const groupedAddresses = new Map();
      addressesToCreate.forEach((addr) => {
        const accountId = accountERCtoId.get(addr.accountERC);
        if (accountId) {
          if (!groupedAddresses.has(accountId)) {
            groupedAddresses.set(accountId, []);
          }
          groupedAddresses.get(accountId).push(addr);
        }
      });

      if (groupedAddresses.size === 0) {
        logger.warn(
          'No addresses could be linked to account IDs. Skipping step.',
          { sessionId }
        );
        await persistence.createBatch({
          erc: createERC(ERC_PREFIX.BATCH),
          sessionId,
          stepKey: 'postal-addresses',
          status: 'BYPASSED',
        });
        return;
      }

      const taskResults = [];
      let totalAddresses = 0;

      for (const [accountId, addresses] of groupedAddresses.entries()) {
        totalAddresses += addresses.length;
        const batchERC = createERC(ERC_PREFIX.BATCH_GENERATION);

        if (options.dryRun) {
          logger.info(
            `DRY RUN: Skipping postal address creation batch submission for account ${accountId}.`
          );
          taskResults.push({
            taskId: `dry-run-${accountId}`,
            count: addresses.length,
          });
        } else {
          const result = await liferay.createAccountAddressBatch(
            config,
            accountId,
            addresses,
            {
              externalReferenceCode: batchERC,
              sessionId,
            }
          );
          taskResults.push({
            taskId: result.batchId,
            count: addresses.length,
            erc: batchERC,
          });
        }
      }

      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH_GENERATION),
        sessionId,
        stepKey: 'postal-addresses',
        status: options.dryRun ? 'SYNCHRONOUS' : 'prepared',
        processedCount: options.dryRun ? totalAddresses : 0,
        totalCount: totalAddresses,
        batchRefs: taskResults,
      });
    } catch (error) {
      logger.error('Failed to start postal address creation step', {
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

  async _runSetBillingAndShippingAddressesStep(sessionId) {
    const { logger, liferay, persistence } = this.ctx;
    const session = await persistence.getSession(sessionId);
    const { config, options, accountsToCreate, addressesToCreate } =
      session.context;

    logger.info('Starting set billing and shipping addresses step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      if (
        !accountsToCreate ||
        accountsToCreate.length === 0 ||
        !addressesToCreate ||
        addressesToCreate.length === 0
      ) {
        logger.info('No accounts or addresses to link. Skipping step.', {
          sessionId,
          correlationId: session.correlationId,
        });
        await persistence.createBatch({
          erc: createERC(ERC_PREFIX.BATCH),
          sessionId,
          stepKey: 'set-billing-and-shipping-addresses',
          status: 'BYPASSED',
        });
        return;
      }

      if (options.dryRun) {
        logger.info(
          'DRY RUN: Skipping set billing and shipping addresses step.'
        );
        await persistence.createBatch({
          erc: createERC(ERC_PREFIX.BATCH),
          sessionId,
          stepKey: 'set-billing-and-shipping-addresses',
          status: 'SYNCHRONOUS',
        });
        return;
      }

      // 1. Resolve address IDs
      const addressERCs = addressesToCreate.map((a) => a.externalReferenceCode);
      const resolvedAddresses = await liferay.resolveByERCsWithRetry(
        config,
        addressERCs,
        (cfg, e) =>
          liferay.getPostalAddressesByERC(cfg, e, [
            'id',
            'externalReferenceCode',
          ]),
        { label: 'postalAddresses' }
      );

      const ercToAddrId = new Map();
      resolvedAddresses.forEach((a) => {
        if (a.externalReferenceCode && a.id)
          ercToAddrId.set(a.externalReferenceCode, a.id);
      });

      // 2. Link to accounts
      let updateCount = 0;
      for (const account of accountsToCreate) {
        if (!account.id) continue;

        const accountAddresses = addressesToCreate.filter(
          (a) => a.accountERC === account.externalReferenceCode
        );
        const billing = accountAddresses.find(
          (a) => a.addressType === 'billing'
        );
        const shipping = accountAddresses.find(
          (a) => a.addressType === 'shipping'
        );

        const patch = {};
        if (billing && ercToAddrId.has(billing.externalReferenceCode)) {
          patch.defaultBillingAddressId = ercToAddrId.get(
            billing.externalReferenceCode
          );
        }
        if (shipping && ercToAddrId.has(shipping.externalReferenceCode)) {
          patch.defaultShippingAddressId = ercToAddrId.get(
            shipping.externalReferenceCode
          );
        }

        if (Object.keys(patch).length > 0) {
          await liferay.rest.patchAccount(config, account.id, patch);
          updateCount++;
        }
      }

      await persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: 'set-billing-and-shipping-addresses',
        status: 'SYNCHRONOUS',
        processedCount: updateCount,
        totalCount: accountsToCreate.length,
      });

      logger.info('Set billing and shipping addresses step complete', {
        sessionId,
        updates: updateCount,
      });
    } catch (error) {
      logger.error('Failed to set billing and shipping addresses', {
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

  validateConfig(config) {
    if (!config.catalogId) throw new Error('catalogId is required');
  }

  async validateOptions(config, options) {
    if (
      !options.accountCount ||
      typeof options.accountCount !== 'number' ||
      options.accountCount <= 0
    ) {
      throw new Error('Valid accountCount is required');
    }
  }

  async _generateAddress(addressType, config, address, countries) {
    const { liferay } = this.ctx;
    const streetNumber = Math.floor(Math.random() * 999) + 1;
    const streetName = randomString(8);
    const streetType = ['Street', 'Avenue', 'Road', 'Lane'][
      Math.floor(Math.random() * 4)
    ];

    if (!countries || countries.length === 0) {
      return {
        name: `${toTitleCase(addressType).replace(/-/g, ' ')} Address`,
        streetAddressLine1: `${streetNumber} ${streetName} ${streetType}`,
        addressLocality: address.addressLocality,
        postalCode: address.postalCode,
        addressType,
        primary: false,
        externalReferenceCode: createERC(ERC_PREFIX.ADDRESS),
      };
    }

    const country = countries[Math.floor(Math.random() * countries.length)];
    if (!country || !country.id) {
      return {
        name: `${toTitleCase(addressType).replace(/-/g, ' ')} Address`,
        streetAddressLine1: `${streetNumber} ${streetName} ${streetType}`,
        addressLocality: address.addressLocality,
        addressRegion: null,
        postalCode: address.postalCode,
        addressCountry: country?.name || 'United States',
        addressType,
        primary: false,
        externalReferenceCode: createERC(ERC_PREFIX.ADDRESS),
      };
    }

    const regions = await liferay.getCountryRegions(config, country.id);

    let region;
    if (regions && regions.length > 0) {
      region = regions[Math.floor(Math.random() * regions.length)];
    }

    return {
      name: `${toTitleCase(addressType).replace(/-/g, ' ')} Address`,
      streetAddressLine1: `${streetNumber} ${streetName} ${streetType}`,
      addressLocality: address.addressLocality,
      addressRegion: region?.name || null,
      postalCode: address.postalCode,
      addressCountry: country?.title_i18n?.en_US || country?.name,
      addressType,
      primary: false,
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
