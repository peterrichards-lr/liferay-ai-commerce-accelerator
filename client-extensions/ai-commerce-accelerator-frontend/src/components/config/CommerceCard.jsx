import React, { useEffect } from 'react';
import ClayCard from '@clayui/card';
import ClayForm, { ClaySelect } from '@clayui/form';
import { useApp } from '../../context/AppContext';
import FieldError from '../ui/FieldError';

export default function CommerceCard({
  disabled,
  catalogs = [],
  channels = [],
  languages = [],
  currencies = [],
  connected = false,
  onSelectChannel,
  onSelectCatalog,
  commerceConfigured,
  errors,
}) {
  const { config, setConfig } = useApp();

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
              {catalogs.length === 0 ? (
                <ClaySelect.Option value="" label="No catalogs found" />
              ) : (
                <>
                  <ClaySelect.Option value="" label="Select a catalog…" />
                  {catalogs.map((c) => (
                    <ClaySelect.Option key={c.id} value={c.id} label={c.name} />
                  ))}
                </>
              )}
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
              {channels.length === 0 ? (
                <ClaySelect.Option value="" label="No channels found" />
              ) : (
                <>
                  <ClaySelect.Option value="" label="Select a channel…" />
                  {channels.map((c) => (
                    <ClaySelect.Option key={c.id} value={c.id} label={c.name} />
                  ))}
                </>
              )}
            </ClaySelect>
            {connected && channels.length === 0 && (
              <small className="text-danger d-block mt-1">
                No channels found. Please ensure you have at least one Channel
                created in Liferay.
              </small>
            )}
            <FieldError errors={errors.channelId} />
          </ClayForm.Group>

          <div
            className="grid"
            style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}
          >
            <div className="mb-3">
              <span className="text-truncate-inline">
                <span className="text-truncate" title="Input Group">
                  Languages
                </span>
              </span>
              <div
                className="border rounded p-2"
                style={{ maxHeight: '200px', overflowY: 'auto' }}
              >
                {languages.length > 0 ? (
                  languages.map((language) => (
                    <div key={language.id} className="form-check">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`language-${language.id}`}
                        checked={
                          config.selectedLanguages?.includes(language.id) ||
                          false
                        }
                        onChange={(e) => {
                          const currentLanguages =
                            config.selectedLanguages || [];
                          const newLanguages = e.target.checked
                            ? [...currentLanguages, language.id]
                            : currentLanguages.filter(
                                (id) => id !== language.id
                              );

                          setConfig({ selectedLanguages: newLanguages });
                        }}
                        disabled={disabled || !config.channelId}
                      />
                      <label
                        className="form-check-label"
                        htmlFor={`language-${language.id}`}
                      >
                        {language.name || language.id}
                      </label>
                    </div>
                  ))
                ) : (
                  <small className="text-muted">
                    {!config.channelId
                      ? 'Select a channel first to load available languages'
                      : 'No languages found'}
                  </small>
                )}
              </div>
              {config.selectedLanguages &&
                config.selectedLanguages.length > 0 && (
                  <small className="form-text text-muted">
                    {config.selectedLanguages.length} language(s) selected
                  </small>
                )}
              <FieldError errors={errors.selectedLanguages} />
            </div>

            <ClayForm.Group>
              <label htmlFor="currencyCode" className="form-label">
                Currency
              </label>
              <ClaySelect
                id="currencyCode"
                aria-label="Currency"
                value={config.currencyCode || ''}
                onChange={(e) => setConfig({ currencyCode: e.target.value })}
                disabled={disabled || !config.channelId}
              >
                {currencies.map((c) => (
                  <ClaySelect.Option
                    key={c.code}
                    value={c.code}
                    label={c.name}
                  />
                ))}
              </ClaySelect>
              <FieldError errors={errors.currencyCode} />
            </ClayForm.Group>
          </div>
        </>
      )}
    </ClayCard>
  );
}
