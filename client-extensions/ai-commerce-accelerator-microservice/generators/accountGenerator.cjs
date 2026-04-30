const BaseGenerator = require('./baseGenerator.cjs');
const { deepCleanIds } = require('../utils/payload-cleaner.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS, ENV } = require('../utils/constants.cjs');
const {
  createERC,
  randomString,
  toTitleCase,
  delay,
  resolveErrorReference,
  fromI18n,
} = require('../utils/misc.cjs');

const S = WORKFLOW_STEPS;

class AccountGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);

    this.steps = {
      [S.LOAD_COUNTRIES]: this._runLoadCountriesStep.bind(this),
      [S.GENERATE_ACCOUNT_DATA]: this._runAccountDataGenerationStep.bind(this),
      [S.CREATE_ACCOUNTS]: this._runAccountCreationStep.bind(this),
      [S.SYNC_DELAY]: this._runInterServiceSyncDelayStep.bind(this),
      [S.RESOLVE_ACCOUNT_IDS]: this._runResolveAccountIdsStep.bind(this),
      [S.CREATE_POSTAL_ADDRESSES]: this._runAddressCreationStep.bind(this),
      [S.SET_ADDRESS_DEFAULTS]:
        this._runSetBillingAndShippingAddressesStep.bind(this),
    };
  }

  /**
   * Standalone entry point for account generation.
   */
  async runWorkflow(config, options) {
    const sessionId = options.sessionId || createERC(ERC_PREFIX.BATCH_SESSION);
    options.sessionId = sessionId;

    if (
      !options.selectedLanguages ||
      (Array.isArray(options.selectedLanguages) &&
        options.selectedLanguages.length === 0)
    ) {
      this.logger.warn(
        `No languages selected for generation. Falling back to DEFAULT_LOCALE: ${ENV.DEFAULT_LOCALE}`,
        { sessionId }
      );
      options.selectedLanguages = [ENV.DEFAULT_LOCALE];
    }

    const steps = [
      { name: S.LOAD_COUNTRIES, type: 'sync' },
      { name: S.GENERATE_ACCOUNT_DATA, type: 'sync' },
      { name: S.CREATE_ACCOUNTS, type: 'sync' },
      { name: S.SYNC_DELAY, type: 'sync' },
      { name: S.RESOLVE_ACCOUNT_IDS, type: 'sync' },
      { name: S.CREATE_POSTAL_ADDRESSES, type: 'sync' },
      { name: S.SET_ADDRESS_DEFAULTS, type: 'sync' },
    ];

    await this.persistence.createSession({
      sessionId,
      flowType: 'accounts',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: {
        config,
        options,
        steps,
        generator: 'account',
      },
    });

    this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );

    return {
      sessionId,
      message: 'Account generation workflow started.',
    };
  }

  async _runLoadCountriesStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config } = session.context;

    this.logger.info('Starting load countries step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      const countries = await this.liferay.getCountries(config);
      this.logger.debug(`Fetched ${countries?.length || 0} countries from Liferay`, { sessionId });

      await this.persistence.updateSessionContext(sessionId, {
        ...session.context,
        countries,
      });

      await this.completeSyncStep(
        sessionId,
        S.LOAD_COUNTRIES,
        'SYNCHRONOUS',
        countries.length,
        countries.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error(`Failed to load countries: ${error.message}`, {
        sessionId,
        errorReferenceCode,
        error,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.LOAD_COUNTRIES,
        status: 'FAILED',
      });
    }
  }

  async _runAccountDataGenerationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, countries } = session.context;

    this.logger.info('Starting account data generation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      const accountDataList = await this.ctx.generation.generateData(
        'account',
        options.accountCount,
        config,
        options
      );

      const accountsToCreate = [];
      const addressesToCreate = [];

      for (const raw of accountDataList) {
        const account = { ...raw };
        if (!account.externalReferenceCode) {
          account.externalReferenceCode = createERC(ERC_PREFIX.ACCOUNT);
        }

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
          account.domains = [...new Set(allDomains)];
          account.accountContactInformation.webUrls = account.domains.map(
            (domain) => ({
              url: `http://${domain}`,
              urlType: 'Website',
              primary: false,
            })
          );
        } else {
          delete account.domains;
        }

        if (account.accountContactInformation?.domains) {
          delete account.accountContactInformation.domains;
        }

        const rawHeadOffice = account.headOfficeAddress;
        const rawBilling = account.billingAddress;
        const rawShipping = account.shippingAddress;

        delete account.headOfficeAddress;
        delete account.billingAddress;
        delete account.shippingAddress;

        if (account.accountContactInformation.postalAddresses) {
          delete account.accountContactInformation.postalAddresses;
        }

        if (rawHeadOffice) {
          const headOffice = await this._generateAddress(
            'other',
            config,
            rawHeadOffice,
            countries,
            sessionId
          );
          // Include in BOTH for maximum visibility in Liferay UI/Headless
          account.accountContactInformation.postalAddresses = [headOffice];
          account.postalAddresses = [headOffice];
        } else {
          account.accountContactInformation.postalAddresses = [];
          account.postalAddresses = [];
        }

        if (rawBilling) {
          addressesToCreate.push({
            ...(await this._generateAddress(
              'billing',
              config,
              rawBilling,
              countries,
              sessionId
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
              countries,
              sessionId
            )),
            accountERC: account.externalReferenceCode,
          });
        }

        accountsToCreate.push(account);
      }

      await this.persistence.updateSessionContext(sessionId, {
        ...session.context,
        accountsToCreate: accountsToCreate,
        addressesToCreate: addressesToCreate,
      });

      await this.completeSyncStep(
        sessionId,
        S.GENERATE_ACCOUNT_DATA,
        'SYNCHRONOUS',
        accountsToCreate.length,
        accountsToCreate.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed execution of generate-account-data step', {
        sessionId,
        correlationId: session.correlationId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.GENERATE_ACCOUNT_DATA,
        status: 'FAILED',
      });
    }
  }

  async _runInterServiceSyncDelayStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { correlationId } = session;

    this.logger.info(
      `Starting inter-service synchronization delay of ${ENV.LIFERAY_SYNC_DELAY_MS}ms`,
      { sessionId, correlationId }
    );

    await delay(ENV.LIFERAY_SYNC_DELAY_MS);

    await this.completeSyncStep(sessionId, S.SYNC_DELAY);

    this.logger.info('Inter-service synchronization delay completed.', {
      sessionId,
      correlationId,
    });
  }

  async _runAccountCreationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, accountsToCreate } = session.context;

    this.logger.info('Starting account creation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      if (!accountsToCreate || accountsToCreate.length === 0) {
        return await this.completeSyncStep(
          sessionId,
          S.CREATE_ACCOUNTS,
          'BYPASSED'
        );
      }

      if (options.dryRun) {
        return await this.completeSyncStep(
          sessionId,
          S.CREATE_ACCOUNTS,
          'SYNCHRONOUS',
          accountsToCreate.length,
          accountsToCreate.length
        );
      }

      const prepared = deepCleanIds(accountsToCreate);

      await this.submitBatch(
        sessionId,
        S.CREATE_ACCOUNTS,
        'accounts',
        'generate',
        (erc) =>
          this.liferay.createAccountsBatch(config, prepared, {
            externalReferenceCode: erc,
            sessionId,
            session,
          }),
        accountsToCreate.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed to start account creation step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.CREATE_ACCOUNTS,
        status: 'FAILED',
      });
    }
  }

  async _runResolveAccountIdsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, accountsToCreate } = session.context;

    if (!accountsToCreate || accountsToCreate.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.RESOLVE_ACCOUNT_IDS,
        'BYPASSED'
      );
    }

    try {
      const ercs = accountsToCreate.map((a) => a.externalReferenceCode);
      const results = await this.liferay.resolveByERCsWithRetry(
        config,
        ercs,
        (cfg, e) =>
          this.liferay.getAccountsByERC(cfg, e, [
            'id',
            'externalReferenceCode',
          ]),
        { label: 'accounts' }
      );

      const normalized = this._normalize(results);
      const ercToIdMap = new Map(normalized.map((item) => [item.erc, item.id]));

      const updatedAccounts = accountsToCreate.map((a) => ({
        ...a,
        id: ercToIdMap.get(a.externalReferenceCode),
      }));

      await this.persistence.updateSessionContext(sessionId, {
        ...session.context,
        accountsToCreate: updatedAccounts,
      });

      await this.completeSyncStep(
        sessionId,
        S.RESOLVE_ACCOUNT_IDS,
        'SYNCHRONOUS',
        ercToIdMap.size,
        ercs.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed to resolve account IDs', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.RESOLVE_ACCOUNT_IDS,
        status: 'FAILED',
      });
    }
  }

  async _runAddressCreationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, accountsToCreate, addressesToCreate } =
      session.context;

    this.logger.info('Starting postal address creation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      if (!addressesToCreate || addressesToCreate.length === 0) {
        return await this.completeSyncStep(
          sessionId,
          S.CREATE_POSTAL_ADDRESSES,
          'BYPASSED'
        );
      }

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
          const { accountERC, ...addressWithoutErc } = addr;
          groupedAddresses.get(accountId).push(addressWithoutErc);
        }
      });

      if (groupedAddresses.size === 0) {
        return await this.completeSyncStep(
          sessionId,
          S.CREATE_POSTAL_ADDRESSES,
          'BYPASSED'
        );
      }

      let submittedAny = false;
      let totalAddresses = 0;
      for (const [accountId, addresses] of groupedAddresses.entries()) {
        totalAddresses += addresses.length;

        if (options.dryRun) {
          // Dry run is handled as sync
        } else {
          submittedAny = true;
          const prepared = deepCleanIds(addresses);
          await this.submitBatch(
            sessionId,
            S.CREATE_POSTAL_ADDRESSES,
            'accounts',
            'generate',
            (erc) =>
              this.liferay.createAccountAddressBatch(
                config,
                accountId,
                prepared,
                {
                  externalReferenceCode: erc,
                  sessionId,
                  session,
                }
              ),
            addresses.length
          );
        }
      }

      if (!submittedAny) {
        await this.completeSyncStep(
          sessionId,
          S.CREATE_POSTAL_ADDRESSES,
          'SYNCHRONOUS',
          totalAddresses,
          totalAddresses
        );
      }
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed to start postal address creation step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.CREATE_POSTAL_ADDRESSES,
        status: 'FAILED',
      });
    }
  }

  async _runSetBillingAndShippingAddressesStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, accountsToCreate, addressesToCreate } =
      session.context;

    this.logger.info('Starting set billing and shipping addresses step', {
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
        return await this.completeSyncStep(
          sessionId,
          S.SET_ADDRESS_DEFAULTS,
          'BYPASSED'
        );
      }

      if (options.dryRun) {
        return await this.completeSyncStep(
          sessionId,
          S.SET_ADDRESS_DEFAULTS,
          'SYNCHRONOUS'
        );
      }

      let updateCount = 0;
      for (const account of accountsToCreate) {
        if (!account.id && !account.externalReferenceCode) continue;

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
        if (billing) {
          patch.defaultBillingAddressExternalReferenceCode =
            billing.externalReferenceCode;
        }
        if (shipping) {
          patch.defaultShippingAddressExternalReferenceCode =
            shipping.externalReferenceCode;
        }

        if (Object.keys(patch).length > 0) {
          // If we have an ID, use it, otherwise use ERC
          if (account.id) {
            await this.liferay.rest.patchAccount(config, account.id, patch);
          } else {
            await this.liferay.rest.patchAccountByERC(
              config,
              account.externalReferenceCode,
              patch
            );
          }
          updateCount++;
        }
      }

      await this.completeSyncStep(
        sessionId,
        S.SET_ADDRESS_DEFAULTS,
        'SYNCHRONOUS',
        updateCount,
        accountsToCreate.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed to set billing and shipping addresses', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.SET_ADDRESS_DEFAULTS,
        status: 'FAILED',
      });
    }
  }

  async _generateAddress(addressType, config, address, countries, sessionId) {
    const streetNumber = Math.floor(Math.random() * 999) + 1;
    const streetName = randomString(8);
    const streetType = ['Street', 'Avenue', 'Road', 'Lane'][
      Math.floor(Math.random() * 4)
    ];

    // 0. Filter for active countries and ensure we have a list
    const activeCountries = (countries || []).filter(c => c.active !== false);

    if (activeCountries.length === 0) {
      this.logger.warn('No active countries found in Liferay. Falling back to default data structure.', { sessionId });
      return {
        name: `${toTitleCase(addressType).replace(/-/g, ' ')} Address`,
        streetAddressLine1: `${streetNumber} ${streetName} ${streetType}`,
        addressLocality: address.addressLocality,
        postalCode: address.postalCode,
        addressType,
        primary: false,
        addressCountry: 'United States', // Use full name for fallback reliability
        externalReferenceCode: createERC(ERC_PREFIX.ADDRESS),
      };
    }

    // Try to find the AI-suggested country in the list from Liferay
    let country = null;
    if (address.addressCountry) {
      const target = address.addressCountry.toLowerCase().replace(/[^a-z0-9]/g, '');
      country = activeCountries.find(
        (c) =>
          c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === target ||
          c.a2.toLowerCase() === target ||
          c.a3?.toLowerCase() === target
      );
    }

    // Fallback to random if no match found or no suggestion provided
    if (!country) {
      country = activeCountries[Math.floor(Math.random() * activeCountries.length)];
    }

    if (!country || !country.id) {
      // Should not happen given the check above, but for safety
      return {
        name: `${toTitleCase(addressType).replace(/-/g, ' ')} Address`,
        streetAddressLine1: `${streetNumber} ${streetName} ${streetType}`,
        addressLocality: address.addressLocality,
        addressRegion: null,
        postalCode: address.postalCode,
        addressCountry: 'United States',
        addressType,
        primary: false,
        externalReferenceCode: createERC(ERC_PREFIX.ADDRESS),
      };
    }

    const regions = await this.liferay.getCountryRegions(config, country.id);
    let region;
    if (regions && regions.length > 0) {
      // Try to match suggested region
      if (address.addressRegion) {
        const targetRegion = address.addressRegion.toLowerCase().replace(/[^a-z0-9]/g, '');
        region = regions.find(
          (r) =>
            r.name.toLowerCase().replace(/[^a-z0-9]/g, '') === targetRegion ||
            r.regionCode?.toLowerCase() === targetRegion
        );
      }
      // Fallback to random
      if (!region) {
        region = regions[Math.floor(Math.random() * regions.length)];
      }
    }

    const finalCountry = fromI18n(country.title_i18n) || country.name || country.a2 || country.a3;
    const finalRegion = region ? (fromI18n(region.title_i18n) || region.name) : null;

    this.logger.debug(`Address Geographic Match: SuggestedCountry="${address.addressCountry}", MatchedCountryName="${country.name}", MatchedCountryTitle="${fromI18n(country.title_i18n)}", FinalCountry="${finalCountry}", SuggestedRegion="${address.addressRegion}", FinalRegion="${finalRegion}"`, { sessionId });

    return {
      name: `${toTitleCase(addressType).replace(/-/g, ' ')} Address`,
      streetAddressLine1: `${streetNumber} ${streetName} ${streetType}`,
      addressLocality: address.addressLocality,
      addressRegion: finalRegion,
      postalCode: address.postalCode,
      // Liferay Headless Admin User API (PostalAddress) dedicated address endpoint 
      // appears to require the full Country Name (e.g. "United States") based on empirical tests.
      addressCountry: finalCountry,
      addressType,
      primary: false,
      externalReferenceCode: createERC(ERC_PREFIX.ADDRESS),
    };

  }
  async handleBatchCallback(sessionId, batchERC) {
    this.logger.debug(
      `Batch callback received for account generation session ${sessionId}`,
      { batchERC }
    );
    return true;
  }
}

module.exports = AccountGenerator;
