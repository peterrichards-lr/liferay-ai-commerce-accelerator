import React, { useEffect, useState } from 'react';
import ClayCard from '@clayui/card';
import ClayForm, { ClaySelect } from '@clayui/form';
import { useApp } from '../../context/AppContext';
import FieldError from '../ui/FieldError';
import CheckboxField from '../ui/CheckboxField';

export default function CommerceCard({
  disabled,
  catalogs = [],
  channels = [],
  languages = [],
  currencies = [],
  connected = false,
  onSelectChannel,
  onSelectCatalog,
  isCreatingChannel = false,
  onCreateDefaultChannel,
  onRefresh,
  commerceConfigured,
  errors,
}) {
  const { config, setConfig } = useApp();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Auto-selection Effect: Monitors selectedCatalog AND the newly loaded availableLanguages.
  // When both are present, find the language in availableLanguages that matches
  // selectedCatalog.defaultLanguageId and automatically add it.
  useEffect(() => {
    if (!connected || !config.catalogId || languages.length === 0) return;

    const selectedCatalog = catalogs.find(
      (c) => String(c.id) === String(config.catalogId)
    );
    if (!selectedCatalog || !selectedCatalog.defaultLanguageId) return;

    const hasLanguage = languages.some(
      (lang) => lang.id === selectedCatalog.defaultLanguageId
    );
    const alreadySelected = config.selectedLanguages?.includes(
      selectedCatalog.defaultLanguageId
    );

    if (hasLanguage && !alreadySelected) {
      const nextLangs = Array.from(
        new Set([
          ...(config.selectedLanguages || []),
          selectedCatalog.defaultLanguageId,
        ])
      );
      setConfig({ selectedLanguages: nextLangs });
    }
  }, [
    connected,
    config.catalogId,
    languages,
    catalogs,
    config.selectedLanguages,
    setConfig,
  ]);

  useEffect(() => {
    if (!connected || catalogs.length === 0) return;

    const currentCatalogId = config.catalogId ? String(config.catalogId) : null;
    const isCurrentValid = catalogs.some(
      (c) => String(c.id) === currentCatalogId
    );

    if (!isCurrentValid || (!config.catalogId && catalogs.length === 1)) {
      onSelectCatalog?.(String(catalogs[0].id));
    }
  }, [connected, catalogs, config.catalogId, onSelectCatalog]);

  useEffect(() => {
    if (!connected || channels.length === 0) return;

    const currentChannelId = config.channelId ? String(config.channelId) : null;
    const isCurrentValid = channels.some(
      (c) => String(c.id) === currentChannelId
    );

    if (!isCurrentValid || (!config.channelId && channels.length === 1)) {
      onSelectChannel?.(String(channels[0].id));
    }
  }, [connected, channels, config.channelId, onSelectChannel]);

  return (
    <ClayCard className="p-4">
      <h3 className="mb-3">Commerce</h3>

      {!connected ? (
        <p className="text-secondary mb-0">
          🔒 Please connect to the microservice first.
        </p>
      ) : (
        <>
          {!commerceConfigured && (
            <small className="section-subtitle">
              Configure Catalog, Channel, Currency, and Languages to enable
              generation.
            </small>
          )}
          <ClayForm.Group className="mb-3">
            <label htmlFor="catalogId" className="form-label">
              Catalog
            </label>
            <ClaySelect
              id="catalogId"
              aria-label="Catalog"
              value={config.catalogId || ''}
              disabled={disabled || catalogs.length === 0}
              onChange={(e) => {
                const id = e.target.value || null;
                onSelectCatalog?.(id);
              }}
            >
              {catalogs.length === 0
                ? [
                    <ClaySelect.Option
                      key="no-catalogs"
                      value=""
                      label="No catalogs found"
                    />,
                  ]
                : [
                    <ClaySelect.Option
                      key="select-catalog"
                      value=""
                      label="Select a catalog…"
                    />,
                    ...catalogs.map((c) => (
                      <ClaySelect.Option
                        key={c.id}
                        value={c.id}
                        label={c.name}
                      />
                    )),
                  ]}
            </ClaySelect>
            {connected && catalogs.length === 0 && (
              <small className="text-danger d-block mt-1">
                No catalogs found. Please ensure you have at least one Catalog
                created in Liferay.
              </small>
            )}
            <FieldError errors={errors.catalogId} />
          </ClayForm.Group>

          <ClayForm.Group className="mb-3">
            <label htmlFor="channelId" className="form-label">
              Channel
            </label>
            <ClaySelect
              id="channelId"
              aria-label="Channel"
              value={config.channelId || ''}
              disabled={disabled || channels.length === 0}
              onChange={(e) => {
                const id = e.target.value || null;
                onSelectChannel?.(id);
              }}
            >
              {channels.length === 0
                ? [
                    <ClaySelect.Option
                      key="no-channels"
                      value=""
                      label="No channels found"
                    />,
                  ]
                : [
                    <ClaySelect.Option
                      key="default-channel"
                      value=""
                      label="Select a channel…"
                    />,
                    ...channels.map((c) => (
                      <ClaySelect.Option
                        key={c.id}
                        value={c.id}
                        label={c.name}
                      />
                    )),
                  ]}
            </ClaySelect>
            {connected && channels.length === 0 && (
              <div className="mt-2">
                <small className="text-danger d-block mb-2">
                  No channels found. Please ensure you have at least one Channel
                  created in Liferay.
                </small>
                <div className="d-flex align-items-center mt-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary px-3 mr-2"
                    onClick={handleRefresh}
                    disabled={disabled || isRefreshing || isCreatingChannel}
                  >
                    {isRefreshing ? 'Refreshing...' : 'Refresh Dropdown'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary px-3"
                    onClick={onCreateDefaultChannel}
                    disabled={disabled || isRefreshing || isCreatingChannel}
                  >
                    {isCreatingChannel
                      ? 'Creating Channel...'
                      : 'Auto-Create Channel'}
                  </button>
                </div>
              </div>
            )}
            <FieldError errors={errors.channelId} />
          </ClayForm.Group>

          <div className="row mt-4">
            <div className="col-12 mb-4">
              <ClayForm.Group className="mb-0">
                <label
                  htmlFor="currencyCode"
                  className="form-label font-weight-semi-bold"
                >
                  Currency
                </label>
                <ClaySelect
                  id="currencyCode"
                  aria-label="Currency"
                  value={config.currencyCode || ''}
                  onChange={(e) => setConfig({ currencyCode: e.target.value })}
                  disabled={disabled || !config.channelId}
                >
                  {currencies.length === 0
                    ? [
                        <ClaySelect.Option
                          key="no-currencies"
                          value=""
                          label="No currencies found"
                        />,
                      ]
                    : [
                        <ClaySelect.Option
                          key="select-currency"
                          value=""
                          label="Select a currency…"
                        />,
                        ...currencies.map((c) => (
                          <ClaySelect.Option
                            key={c.code}
                            value={c.code}
                            label={`${c.name} (${c.code})`}
                          />
                        )),
                      ]}
                </ClaySelect>
                <FieldError errors={errors.currencyCode} />
              </ClayForm.Group>
            </div>

            <div className="col-12 mb-3">
              <label className="form-label font-weight-semi-bold">
                Languages
              </label>
              <div
                className="border rounded p-3 bg-white"
                style={{ maxHeight: '200px', overflowY: 'auto' }}
              >
                {languages.length > 0 ? (
                  languages.map((language) => (
                    <CheckboxField
                      key={language.id}
                      id={`language-${language.id}`}
                      label={language.name || language.id}
                      checked={
                        config.selectedLanguages?.includes(language.id) || false
                      }
                      onChange={(checked) => {
                        const currentLanguages = config.selectedLanguages || [];
                        const newLanguages = checked
                          ? [...currentLanguages, language.id]
                          : currentLanguages.filter((id) => id !== language.id);

                        setConfig({ selectedLanguages: newLanguages });
                      }}
                      disabled={disabled || !config.channelId}
                      muted={disabled || !config.channelId}
                    />
                  ))
                ) : (
                  <small className="text-muted d-block p-1">
                    {!config.channelId
                      ? 'Select a channel first to load available languages'
                      : 'No languages found'}
                  </small>
                )}
              </div>
              {config.selectedLanguages &&
                config.selectedLanguages.length > 0 && (
                  <small className="form-text text-muted mt-2">
                    {config.selectedLanguages.length} language(s) selected
                  </small>
                )}
              <FieldError errors={errors.selectedLanguages} />
            </div>
          </div>
        </>
      )}
    </ClayCard>
  );
}
