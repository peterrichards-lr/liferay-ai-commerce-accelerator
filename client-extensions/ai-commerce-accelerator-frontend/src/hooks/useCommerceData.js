import { useState, useCallback } from 'react';
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

const toInt = (v) => (v == null || v === '' ? undefined : parseInt(v, 10));

export default function useCommerceData({
  addLog,
  setConnectionEstablished,
  setOpenAiKeyAvailable,
  setConnectionErrors,
  ping,
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

        catalogId: toInt(config.catalogId),
        channelId:
          channel?.id != null ? toInt(channel.id) : toInt(config.channelId),
        siteGroupId:
          channel?.siteGroupId ?? siteGroupId ?? toInt(config.siteGroupId),
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

  const loadRootLists = async () => {
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
  };

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
      setOpenAiKeyAvailable(false);
      throw new Error(res?.message || 'Failed to establish connection.');
    }

    addLog(res.message || 'Connected.', 'success');

    setOpenAiKeyAvailable(Boolean(res.openAiKeyAvailable));

    const wsOk = ping();
    if (!wsOk) {
      addLog('Unable to ping web socket.', 'warning');
    }

    await loadRootLists();
    setConnectionEstablished(true);

    return res;
  };

  const logDeletionSummary = (summary) => {
    if (!summary || typeof summary !== 'object') return;

    const plural = (n, s, p = s + 'es') => `${n} ${n === 1 ? s : p}`;

    Object.entries(summary).forEach(([entity, s]) => {
      if (!s) return;
      const total = s.total ?? 0;
      const batches = s.batches ?? 0;
      const batchesText = plural(batches, 'batch', 'batches');
      const dryTag = s.dryRun ? ' (dry run)' : '';

      addLog(
        `Submitted ${entity} for deletion: ${total} over ${batchesText}${dryTag}`,
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
  };

  const handleDeleteAllCommerceData = useCallback(async () => {
    const payload = buildPayload();
    const res = await api.post(DELETE_COMMERCE_DATA, payload);
    if (res?.summary) {
      logDeletionSummary(res.summary);
    }
  });

  const handleDeleteSelectedCommerceData = useCallback(async () => {
    const payload = buildPayload();
    const res = await api.post(DELETE_SELECTED_COMMERCE_DATA, payload);
    if (res?.summary) {
      logDeletionSummary(res.summary);
    }
  });

  const loadChannelDependent = async (channelOrId) => {
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

    const langs = Array.isArray(langsRes?.languages) ? langsRes.languages : [];
    const currs = Array.isArray(currsRes?.currencies)
      ? currsRes.currencies
      : [];

    setLanguages(langs);
    setCurrencies(currs);

    const selectLangs = langs
      .filter((lang) => lang.markedAsDefault)
      .map((lang) => lang.id);

    setConfig((prev) => ({
      ...prev,
      channelId: chObj.id,
      siteGroupId: chObj.siteGroupId,
      selectedLanguages: selectLangs,
      ...(prev.currencyCode
        ? {}
        : chObj.currencyCode
          ? { currencyCode: chObj.currencyCode }
          : {}),
    }));

    return chObj;
  };

  const selectChannel = async (
    channelObjOrId,
    { selectedLanguages, currencyCode } = {}
  ) => {
    const chObj = await loadChannelDependent(channelObjOrId);
    if (!chObj) return;

    setConfig((prev) => {
      const available = new Set(
        (languages || []).map((l) => l.code ?? l.locale ?? l.id)
      );
      const nextLangs = Array.isArray(selectedLanguages)
        ? selectedLanguages.filter((code) => available.has(code))
        : prev.selectedLanguages;

      const nextCurr =
        currencyCode ?? prev.currencyCode ?? chObj.currencyCode ?? '';

      return {
        ...prev,
        channelId: chObj.id,
        siteGroupId: chObj.siteGroupId,
        selectedLanguages: nextLangs,
        currencyCode: nextCurr,
      };
    });
  };

  const getCategories = useCallback(
    (payload, { force = false } = {}) => {
      const key = `categories:${config.microserviceUrl || ''}:${
        config.liferayUrl || ''
      }`;
      return api.get(GET_CATEGORIES, { force }).then((res) => {
        if (Array.isArray(res?.categories)) return res.categories;
        return [];
      });
    },
    [api, config.microserviceUrl, config.liferayUrl]
  );

  useEffect(() => {
    if (config.channelId && channels.length > 0 && languages.length === 0) {
      const chObj = channels.find(
        (c) => String(c.id) === String(config.channelId)
      );
      if (chObj && chObj.siteGroupId) {
        loadChannelDependent(chObj);
      }
    }
  }, [config.channelId, channels, languages.length]);

  return {
    catalogs,
    channels,
    languages,
    currencies,
    categories: getCategories,
    buildPayload,
    loadRootLists,
    selectChannel,
    testConnection,
    handleDeleteAllCommerceData,
    handleDeleteSelectedCommerceData,
  };
}
