import { useState, useCallback, useEffect } from 'react';
import { useApp, useApi } from '../context/AppContext';
import notifyUser from '../utils/notifications';
import { getConnectionErrorsMap, hasAnyErrors } from '../utils/validation';
import {
  GET_CATALOGS,
  GET_CHANNELS,
  GET_CATEGORIES,
  TEST_CONNECTION,
  DELETE_COMMERCE_DATA,
  DELETE_SELECTED_COMMERCE_DATA,
} from '../utils/microservicePaths';
export default function useCommerceData({
  addLog,
  setConnectionEstablished,
  setAiKeyAvailable,
  setAiMediaKeyAvailable,
  setConnectionErrors,
  _ping,
}) {
  const { config, setConfig, getLanguages, getCurrencies } = useApp();
  const api = useApi();
  const [catalogs, setCatalogs] = useState([]);
  const [channels, setChannels] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [currencies, setCurrencies] = useState([]);

  const buildPayload = useCallback(
    (overrides = {}) => {
      const {
        includeCredentials = !config.liferayHosted,
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
        siteGroupId: channel?.siteGroupId ?? siteGroupId ?? config.siteGroupId,
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

      return base;
    },
    [config]
  );

  const loadRootLists = useCallback(async () => {
    const payload = buildPayload();

    const [cat, ch] = await Promise.all([
      api.post(GET_CATALOGS, payload),
      api.post(GET_CHANNELS, payload),
    ]);

    const cats = Array.isArray(cat?.catalogs) ? cat.catalogs : [];
    const chs = Array.isArray(ch?.channels) ? ch.channels : [];

    setCatalogs(cats);
    setChannels(chs);

    return { catalogs: cats, channels: chs };
  }, [api, buildPayload]);

  const testConnection = async () => {
    const errs = getConnectionErrorsMap(config);
    setConnectionErrors(errs);

    if (hasAnyErrors(errs)) {
      const firstKey = Object.keys(errs)[0];
      requestAnimationFrame(() => {
        const el = document.getElementById(`conn_${firstKey}`);
        if (el) el.focus();
      });
      throw new Error('Fix the highlighted issues to continue.');
    }

    const payload = buildPayload();
    const res = await api.post(TEST_CONNECTION, payload);

    if (!res?.success) {
      setConnectionEstablished(false);
      setAiKeyAvailable(false);
      setAiMediaKeyAvailable && setAiMediaKeyAvailable(false);
      throw new Error(res?.message || 'Failed to establish connection.');
    }

    addLog(res.message || 'Connected.', 'success');

    setAiKeyAvailable(Boolean(res.aiTextKeyAvailable));
    setAiMediaKeyAvailable &&
      setAiMediaKeyAvailable(Boolean(res.aiMediaKeyAvailable));

    await loadRootLists();
    setConnectionEstablished(true);

    return res;
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

      const langs = Array.isArray(langsRes?.languages)
        ? langsRes.languages
        : Array.isArray(langsRes)
          ? langsRes
          : [];
      const currs = Array.isArray(currsRes?.currencies)
        ? currsRes.currencies
        : Array.isArray(currsRes)
          ? currsRes
          : [];

      setLanguages(langs);
      setCurrencies(currs);

      return { chObj, langs, currs };
    },
    [channels, loadRootLists, buildPayload, getLanguages, getCurrencies]
  );

  const selectChannel = useCallback(
    async (channelId) => {
      if (!channelId) {
        setConfig((prev) => ({
          ...prev,
          channelId: null,
          siteGroupId: null,
          selectedLanguages: [],
          currencyCode: '',
        }));
        setLanguages([]);
        setCurrencies([]);
        return;
      }

      const result = await loadChannelDependent(channelId);
      if (!result) return;

      const { chObj, langs } = result;

      setConfig((prev) => {
        const availableIds = new Set(langs.map((l) => l.id));

        // Keep previous selected languages if they are still valid for the new channel
        const filteredLangs = (prev.selectedLanguages || []).filter((id) =>
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

        return {
          ...prev,
          channelId: chObj.id,
          siteGroupId: chObj.siteGroupId,
          selectedLanguages: nextLangs,
          currencyCode: chObj.currencyCode || prev.currencyCode || '',
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

      const catObj = catalogs.find((c) => String(c.id) === String(catalogId));
      if (!catObj) return;

      setConfig((prev) => {
        const nextConfig = { ...prev, catalogId: catObj.id };

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
        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadChannelDependent(chObj);
      }
    }
  }, [config.channelId, channels, languages.length, loadChannelDependent]);

  const logDeletionSummary = useCallback(
    (summary) => {
      if (!summary || typeof summary !== 'object') return;

      const plural = (n, s, p = s + 'es') => `${n} ${n === 1 ? s : p}`;

      Object.entries(summary).forEach(([entity, s]) => {
        if (!s) return;
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

  const handleDeleteAllCommerceData = useCallback(async () => {
    const payload = buildPayload();
    const res = await api.post(DELETE_COMMERCE_DATA, payload);
    if (res?.summary) {
      logDeletionSummary(res.summary);
    }
  }, [api, buildPayload, logDeletionSummary]);

  const handleDeleteSelectedCommerceData = useCallback(async () => {
    const payload = buildPayload();
    const res = await api.post(DELETE_SELECTED_COMMERCE_DATA, payload);
    if (res?.summary) {
      logDeletionSummary(res.summary);
    }
  }, [api, buildPayload, logDeletionSummary]);

  return {
    catalogs,
    channels,
    languages,
    currencies,
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
