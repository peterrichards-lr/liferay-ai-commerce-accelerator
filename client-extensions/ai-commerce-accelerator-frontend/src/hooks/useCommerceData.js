import { useState, useCallback, useEffect } from 'react';
import { useApp, useApi } from '../context/AppContext';
import { catalogCurrency, findCatalog } from '../config/commerceSetup';
import notifyUser from '../utils/notifications';
import { getConnectionErrorsMap, hasAnyErrors } from '../utils/validation';
import {
  GET_CATALOGS,
  GET_CHANNELS,
  GET_SITES,
  GET_WAREHOUSES,
  CREATE_CATALOG,
  CREATE_CHANNEL,
  GET_CATEGORIES,
  TEST_CONNECTION,
  DELETE_COMMERCE_DATA,
  DELETE_SELECTED_COMMERCE_DATA,
} from '../utils/microservicePaths';

// The cached getters answer with the route's envelope, with a bare array from
// their own cache, and with `[]` when the call failed. One reader per list
// rather than the shape test repeated at each call site.
const asList = (res, key) =>
  Array.isArray(res?.[key]) ? res[key] : Array.isArray(res) ? res : [];

const asCurrencies = (res) => asList(res, 'currencies');
const asLanguages = (res) => asList(res, 'languages');

export default function useCommerceData({
  addLog,
  setConnectionEstablished,
  setAiKeyAvailable,
  setAiMediaKeyAvailable,
  setConnectionErrors,
  setProgress,
  _ping,
}) {
  const { config, setConfig, getLanguages, getCurrencies } = useApp();
  const api = useApi();
  const [catalogs, setCatalogs] = useState([]);
  const [channels, setChannels] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [currencies, setCurrencies] = useState([]);
  const [sites, setSites] = useState([]);
  // null means not known, which is different from zero. See loadRootLists.
  const [warehouseCount, setWarehouseCount] = useState(null);
  const [isCreatingCommerce, setIsCreatingCommerce] = useState(false);

  const buildPayload = useCallback(
    (overrides = {}) => {
      const {
        includeCredentials = true,
        channel,
        siteGroupId,
        ...rest
      } = overrides;

      const base = {
        liferayUrl: config.liferayUrl,
        microserviceUrl: config.microserviceUrl,
        localeCode: config.localeCode,
        languageId: config.languageId,
        pollingDelay: config.pollingDelay,
        pollingRetries: config.pollingRetries,

        catalogId: config.catalogId,
        channelId: channel?.id != null ? String(channel.id) : config.channelId,
        siteGroupId: channel?.siteGroupId || siteGroupId || config.siteGroupId,
        currencyCode: config.currencyCode,

        aiModel: config.aiModel,
        batchSize: config.batchSize,
        selectedLanguages: Array.isArray(config.selectedLanguages)
          ? config.selectedLanguages
          : config.selectedLanguages
            ? [config.selectedLanguages]
            : [],

        ...rest,
      };

      if (includeCredentials && config.clientId && config.clientSecret) {
        base.clientId = config.clientId;
        base.clientSecret = config.clientSecret;
      }

      // The second connection travels the same whitelist as the first, which
      // is why #1044 had to land before this could: behind App.jsx's old
      // wholesale spread a second credential set would have doubled what #820
      // exposed. Credentials attach only when both halves are present, the
      // same rule the target connection follows above - half a credential is
      // not a credential, and sending one produces an authentication failure
      // that reads as a wrong password. See #824.
      const configSourceUrl = (config.configSourceUrl || '').trim();

      if (config.configSourceEnabled && configSourceUrl) {
        base.configSource = { liferayUrl: configSourceUrl };

        if (
          includeCredentials &&
          config.configSourceClientId &&
          config.configSourceClientSecret
        ) {
          base.configSource.clientId = config.configSourceClientId;
          base.configSource.clientSecret = config.configSourceClientSecret;
        }
      }

      return base;
    },
    [config]
  );

  const loadRootLists = useCallback(async () => {
    const payload = buildPayload();

    // The warehouse count comes along for the ride so the generator form can
    // say what "top up to five" will actually create, and rule out "use only
    // the ones already there" when there are none. A failure here must not
    // cost the catalogs and channels, which the form cannot work without, so
    // it settles to null - "not known" - rather than to zero, which would
    // wrongly read as "none exist" and disable a valid option (#730).
    // Currencies and sites are company-scoped - `get-currencies` destructures
    // neither channelId nor siteGroupId - so they load here rather than behind
    // a channel selection. That is what lets the setup dialog offer a currency
    // on an instance that has no channel yet, which is the instance it exists
    // for (#746). Neither is worth losing the catalogs and channels over, so
    // both settle to an empty list rather than failing the load.
    const [cat, ch, wh, curr, site] = await Promise.all([
      api.post(GET_CATALOGS, payload),
      api.post(GET_CHANNELS, payload),
      api.post(GET_WAREHOUSES, payload).catch(() => null),
      getCurrencies(payload),
      api.post(GET_SITES, payload).catch(() => null),
    ]);

    const cats = Array.isArray(cat?.catalogs) ? cat.catalogs : [];
    const chs = Array.isArray(ch?.channels) ? ch.channels : [];
    const warehouseTotal = Array.isArray(wh?.warehouses)
      ? wh.warehouses.length
      : null;
    const currs = asCurrencies(curr);
    const siteList = Array.isArray(site?.sites) ? site.sites : [];

    setCatalogs(cats);
    setChannels(chs);
    setWarehouseCount(warehouseTotal);
    setSites(siteList);

    // An empty answer must not wipe a list the channel-scoped load already
    // filled, or selecting a channel and then refreshing would empty the
    // currency dropdown.
    if (currs.length > 0) {
      setCurrencies(currs);
    }

    return {
      catalogs: cats,
      channels: chs,
      currencies: currs,
      sites: siteList,
      warehouseCount: warehouseTotal,
    };
  }, [api, buildPayload, getCurrencies]);

  const testConnection = async (options = {}) => {
    const { silent = false } = options;

    const errs = getConnectionErrorsMap(config);
    if (!silent) setConnectionErrors(errs);

    if (hasAnyErrors(errs)) {
      if (silent) return;

      const firstKey = Object.keys(errs)[0];
      requestAnimationFrame(() => {
        const el = document.getElementById(`conn_${firstKey}`);
        if (el) el.focus();
      });
      console.error('[DEBUG] testConnection validation failed:', errs);
      throw new Error('Fix the highlighted issues to continue.');
    }

    try {
      const payload = buildPayload();
      const res = await api.post(TEST_CONNECTION, payload);

      if (!res?.success) {
        setConnectionEstablished(false);
        setAiKeyAvailable(false);
        setAiMediaKeyAvailable && setAiMediaKeyAvailable(false);

        if (!silent) {
          throw new Error(res?.message || 'Failed to establish connection.');
        }
        return res;
      }

      if (!silent) {
        addLog(res.message || 'Connected.', 'success');
      }

      setAiKeyAvailable(Boolean(res.aiTextKeyAvailable));
      setAiMediaKeyAvailable &&
        setAiMediaKeyAvailable(Boolean(res.aiMediaKeyAvailable));

      await loadRootLists();
      setConnectionEstablished(true);

      return res;
    } catch (err) {
      console.error('[DEBUG] testConnection error:', err.message, err);
      setConnectionEstablished(false);

      const milestone = err.response?.data?.bootMilestone || err?.bootMilestone;
      if (milestone) {
        err.message = `Liferay is booting (${milestone})...`;
      }

      if (!silent) throw err;
    }
  };

  const loadChannelDependent = useCallback(
    async (channelOrId) => {
      let chObj =
        channelOrId && typeof channelOrId === 'object'
          ? channelOrId
          : (channels || []).find((c) => String(c.id) === String(channelOrId));

      if (!chObj) {
        const fresh = (await loadRootLists()).channels;
        chObj = fresh.find((c) => String(c.id) === String(channelOrId));
        if (!chObj) {
          notifyUser(
            'Selected channel not found. Please test the connection again.',
            'warning'
          );
          return null;
        }
      }

      const payload = buildPayload({ channel: chObj });

      const [langsRes, currsRes] = await Promise.all([
        getLanguages(payload),
        getCurrencies(payload),
      ]);

      const langs = asLanguages(langsRes);
      const currs = asCurrencies(currsRes);

      setLanguages(langs);
      setCurrencies(currs);

      return { chObj, langs, currs };
    },
    [channels, loadRootLists, buildPayload, getLanguages, getCurrencies]
  );

  // `preferences` lets a caller state the languages and currency the channel
  // should be selected with - an import knows what the exported configuration
  // asked for. They are still filtered against what the channel actually
  // offers, so a preference for something the channel does not have falls back
  // to the channel's own defaults.
  const selectChannel = useCallback(
    async (channelId, preferences = {}) => {
      if (!channelId) {
        setConfig((prev) => ({
          ...prev,
          channelId: null,
          siteGroupId: null,
          selectedLanguages: [],
          // Languages and the site come from the channel, so clearing it
          // clears them. A currency does not: an import states one, and an
          // imported channel that does not exist here is no reason to discard
          // it. Dropping it was how a configuration asking for EUR reached the
          // create route with nothing, and left with USD (#745).
          currencyCode: preferences.currencyCode ?? '',
        }));
        setLanguages([]);
        setCurrencies([]);
        return;
      }

      const result = await loadChannelDependent(channelId);
      if (!result) return;

      const { chObj, langs, currs } = result;

      setConfig((prev) => {
        const availableIds = new Set(langs.map((l) => l.id));

        // Preferred languages when the caller named some, otherwise the ones
        // already selected - either way only those the new channel still offers
        const requestedLangs = Array.isArray(preferences.selectedLanguages)
          ? preferences.selectedLanguages
          : prev.selectedLanguages;

        const filteredLangs = (requestedLangs || []).filter((id) =>
          availableIds.has(id)
        );

        // If none of previous are valid, select default from new channel
        let nextLangs = filteredLangs;
        if (filteredLangs.length === 0) {
          nextLangs = langs.filter((l) => l.markedAsDefault).map((l) => l.id);
        }

        // If still nothing, and we have languages, just pick the first
        if (nextLangs.length === 0 && langs.length > 0) {
          nextLangs = [langs[0].id];
        }

        const availableCurrencies = new Set(currs.map((c) => c.code));
        const preferredCurrency = availableCurrencies.has(
          preferences.currencyCode
        )
          ? preferences.currencyCode
          : null;

        // The channel no longer writes the run's currency (#746). It used to
        // take `chObj.currencyCode`, and since price lists are written into the
        // *catalog* denominated by this field, selecting a EUR channel against
        // the USD `Master` catalog produced euro price lists inside a dollar
        // catalog. The catalog owns it now; a stated preference still wins,
        // because an import knows what it asked for.
        return {
          ...prev,
          channelId: chObj.id,
          siteGroupId: chObj.siteGroupId,
          selectedLanguages: nextLangs,
          currencyCode: preferredCurrency || prev.currencyCode || '',
        };
      });
    },
    [loadChannelDependent, setConfig]
  );

  const selectCatalog = useCallback(
    (catalogId) => {
      if (!catalogId) {
        setConfig((prev) => ({ ...prev, catalogId: null }));
        return;
      }

      const catObj = findCatalog(catalogs, catalogId);
      if (!catObj) return;

      // The catalog is what price lists are written into, and a catalog's
      // currency is what they are denominated in, so selecting one settles the
      // run's currency (#746). A catalog reporting none leaves the previous
      // value standing rather than clearing it: an empty currency is what
      // refuses a generation, and it is not something a selection should
      // silently cause.
      const currency = catalogCurrency(catObj);

      setConfig((prev) => {
        const nextConfig = {
          ...prev,
          catalogId: catObj.id,
          currencyCode: currency || prev.currencyCode,
        };

        // If we have a default language for the catalog, and it's available in the channel's languages
        if (catObj.defaultLanguageId) {
          const isAvailable = languages.some(
            (l) => l.id === catObj.defaultLanguageId
          );
          if (
            isAvailable &&
            !prev.selectedLanguages?.includes(catObj.defaultLanguageId)
          ) {
            nextConfig.selectedLanguages = [
              ...(prev.selectedLanguages || []),
              catObj.defaultLanguageId,
            ];
          }
        }

        return nextConfig;
      });
    },
    [catalogs, languages, setConfig]
  );

  /**
   * The locales a site offers, for the setup dialog.
   *
   * The dialog cannot use the card's `languages`: those belong to the *selected
   * channel's* site, and the instance the dialog exists for has no channel yet
   * (#746). It asks for the site it is about to use and reads that one's
   * locales instead.
   */
  const loadSiteLanguages = useCallback(
    async (siteGroupId) => {
      if (!siteGroupId) return [];

      return asLanguages(await getLanguages(buildPayload({ siteGroupId })));
    },
    [buildPayload, getLanguages]
  );

  /**
   * Creates a catalog, a channel, or both, from one dialog (#746).
   *
   * One action rather than two, because the catalog owns the currency and a
   * channel's has to agree with the catalog backing it. Two independent creates
   * are precisely the affordance that produces a mismatched pair, which is the
   * defect this area exists to close.
   *
   * The currency comes from exactly one place: the catalog being created, or
   * the catalog already selected. With neither it **refuses**, rather than
   * reaching for the USD that made `Master` the only catalog AICA could ever
   * generate into (#745, #1014).
   *
   * Both halves report what came back rather than what was asked for. The
   * request is the intention and the response is the fact, and the two are only
   * the same until they are not.
   */
  const createCommerceSetup = useCallback(
    async ({ catalog = null, channel = null } = {}) => {
      if (!catalog && !channel) {
        return { success: false, reason: 'nothing-requested' };
      }

      const selectedCatalogCurrency = catalogCurrency(
        findCatalog(catalogs, config.catalogId)
      );
      const requestedCurrency = catalog
        ? String(catalog.currencyCode ?? '').trim()
        : selectedCatalogCurrency;

      if (!requestedCurrency) {
        const message =
          'No currency could be determined, so nothing was created. A ' +
          'currency comes from the catalog it is created with, or from the ' +
          'catalog already selected - and neither names one. Nothing is ' +
          'chosen on your behalf, because a catalog denominates every price ' +
          'written into it.';
        notifyUser(message, 'danger');
        addLog?.(message, 'error');
        return { success: false, reason: 'no-currency' };
      }

      setIsCreatingCommerce(true);
      try {
        let createdCatalog = null;
        let currencyCode = requestedCurrency;

        if (catalog) {
          const res = await api.post(
            CREATE_CATALOG,
            buildPayload({
              currencyCode: requestedCurrency,
              defaultLanguageId: catalog.defaultLanguageId,
              name: catalog.name,
            })
          );

          if (!res?.success || !res?.catalog) {
            throw new Error(res?.error || 'Failed to create catalog');
          }

          createdCatalog = res.catalog;
          const catalogGotCurrency = catalogCurrency(createdCatalog);

          addLog?.(
            `Created catalog '${createdCatalog.name}' (ID: ${createdCatalog.id}) in ` +
              `${catalogGotCurrency || 'an unreported currency'}.`,
            'info'
          );

          if (catalogGotCurrency && catalogGotCurrency !== requestedCurrency) {
            addLog?.(
              `The catalog was asked for in ${requestedCurrency} but was created in ` +
                `${catalogGotCurrency}. Every price generated into it is denominated ` +
                'in that, so check it before generating.',
              'warning'
            );
          }

          // The catalog Liferay actually made, not the one that was asked for:
          // a channel created against the request would be the mismatched pair
          // this dialog exists to prevent.
          currencyCode = catalogGotCurrency || requestedCurrency;
        }

        let createdChannel = null;

        if (channel) {
          const res = await api.post(
            CREATE_CHANNEL,
            buildPayload({
              currencyCode,
              name: channel.name,
              siteGroupId: channel.siteGroupId,
              siteType: channel.siteType,
            })
          );

          if (!res?.success || !res?.channel) {
            throw new Error(res?.error || 'Failed to create channel');
          }

          createdChannel = res.channel;
          const channelGotCurrency = String(
            createdChannel.currencyCode ?? ''
          ).trim();

          addLog?.(
            `Created channel '${createdChannel.name}' (ID: ${createdChannel.id}) in ` +
              `${channelGotCurrency || 'an unreported currency'}.`,
            'info'
          );

          if (channelGotCurrency && channelGotCurrency !== currencyCode) {
            addLog?.(
              `The channel was asked for in ${currencyCode}, the catalog's currency, but ` +
                `was created in ${channelGotCurrency}. The storefront will display a ` +
                'currency the prices are not written in.',
              'warning'
            );
          }

          // A new channel *displays* B2C while storing nothing, so the route
          // reads the type back and reports what the instance holds. Anything
          // short of a confirmed read is said out loud rather than presented as
          // a type that was set (#622, #1045).
          if (res.siteType && !res.siteType.applied) {
            addLog?.(res.siteType.message, 'warning');
          } else if (res.siteType?.applied) {
            addLog?.(
              `The channel's commerce site type reads back as ` +
                `${res.siteType.siteTypeLabel || res.siteType.requested}.`,
              'info'
            );
          }
        }

        const fresh = await loadRootLists();

        if (createdCatalog) {
          setConfig((prev) => ({
            ...prev,
            catalogId: createdCatalog.id,
            currencyCode,
          }));
        }

        if (createdChannel) {
          await selectChannel(String(createdChannel.id));
        }

        notifyUser(
          [createdCatalog && 'Catalog', createdChannel && 'Channel']
            .filter(Boolean)
            .join(' and ') + ' created.',
          'success'
        );

        return {
          success: true,
          catalog: createdCatalog,
          channel: createdChannel,
          catalogs: fresh?.catalogs,
          channels: fresh?.channels,
        };
      } catch (error) {
        notifyUser(`Commerce setup failed: ${error.message}`, 'danger');
        addLog?.(`Failed to create commerce setup: ${error.message}`, 'error');
        return { success: false, reason: 'failed', error: error.message };
      } finally {
        setIsCreatingCommerce(false);
      }
    },
    [
      addLog,
      api,
      buildPayload,
      catalogs,
      config.catalogId,
      loadRootLists,
      selectChannel,
      setConfig,
    ]
  );

  const getCategories = useCallback(
    (payload, { force = false } = {}) => {
      return api.get(GET_CATEGORIES, { force }).then((res) => {
        if (Array.isArray(res?.categories)) return res.categories;
        return [];
      });
    },
    [api]
  );

  useEffect(() => {
    if (config.channelId && channels.length > 0 && languages.length === 0) {
      const chObj = channels.find(
        (c) => String(c.id) === String(config.channelId)
      );
      if (chObj && chObj.siteGroupId) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- load channel dependent entities (languages/catalogs) when channel is resolved
        loadChannelDependent(chObj);
      }
    }
  }, [config.channelId, channels, languages.length, loadChannelDependent]);

  const logDeletionSummary = useCallback(
    (summary) => {
      if (!summary || typeof summary !== 'object') return;

      const plural = (n, s, p = s + 'es') => `${n} ${n === 1 ? s : p}`;

      Object.entries(summary).forEach(([entity, s]) => {
        if (!s || typeof s !== 'object' || s.total === undefined) return;
        const total = s.total ?? 0;
        const batches = s.batches ?? 0;
        const batchesText = plural(batches, 'batch', 'batches');
        const dryRunTag = s.dryRun ? ' (dry run)' : '';

        addLog(
          `Submitted ${entity} for deletion: ${total} over ${batchesText}${dryRunTag}`,
          'info'
        );

        const failures = Array.isArray(s.failures) ? s.failures : [];
        if (failures.length > 0) {
          addLog(
            `${entity}: ${failures.length} failure${
              failures.length === 1 ? '' : 's'
            }`,
            'error'
          );
        }
      });
    },
    [addLog]
  );

  /**
   * The delete endpoints create the session and return; the run itself takes
   * minutes. Declaring the workflow complete on the response put "COMPLETED,
   * 100% Total Removal" on screen at the instant a delete was accepted, and
   * the run it described was reported clear while products, accounts, options
   * and specifications were still being removed - three bug reports raised
   * against steps that had not run yet (#786).
   *
   * Handing the session to the monitor is what the response is for, and it is
   * what the generate flow does with its own. The status it earns comes from
   * the run: the session-completed event, or the status hydration behind it.
   */
  const startDeletionSession = useCallback(
    (res) => {
      if (!res?.sessionId) return;
      if (addLog) {
        addLog(
          `Deletion session started. Session ID: ${res.sessionId}`,
          'info'
        );
      }
      if (setProgress) {
        setProgress({
          type: 'SET_ACTIVE_SESSION',
          sessionId: res.sessionId,
          flowType: 'delete',
        });
      }
    },
    [addLog, setProgress]
  );

  const handleDeleteAllCommerceData = useCallback(async () => {
    if (setProgress) setProgress({ type: 'RESET_ALL' });
    const payload = buildPayload();
    const res = await api.post(DELETE_COMMERCE_DATA, payload);
    if (res?.summary) {
      logDeletionSummary(res.summary);
      startDeletionSession(res);
    }
  }, [
    api,
    buildPayload,
    logDeletionSummary,
    startDeletionSession,
    setProgress,
  ]);

  const handleDeleteSelectedCommerceData = useCallback(
    async (scope) => {
      if (setProgress) setProgress({ type: 'RESET_ALL' });
      const payload = buildPayload({ deleteScope: scope });
      const res = await api.post(DELETE_SELECTED_COMMERCE_DATA, payload);
      if (res?.summary) {
        logDeletionSummary(res.summary);
        startDeletionSession(res);
      }
    },
    [api, buildPayload, logDeletionSummary, startDeletionSession, setProgress]
  );

  return {
    catalogs,
    channels,
    languages,
    currencies,
    sites,
    warehouseCount,
    isCreatingCommerce,
    createCommerceSetup,
    loadSiteLanguages,
    categories: getCategories,
    buildPayload,
    loadRootLists,
    selectChannel,
    selectCatalog,
    testConnection,
    handleDeleteAllCommerceData,
    handleDeleteSelectedCommerceData,
  };
}
