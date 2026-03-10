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

  useEffect(() => {
    if (!connected) return;
    if (!config.catalogId && catalogs.length === 1) {
      onSelectCatalog?.(Number(catalogs[0].id));
    }
  }, [connected, catalogs, config.catalogId, onSelectCatalog]);

  useEffect(() => {
    if (!connected) return;
    if (!config.channelId && channels.length === 1) {
      onSelectChannel?.(Number(channels[0].id));
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
              disabled={disabled}
              onChange={(e) => {
                const id = Number(e.target.value) || null;
                onSelectCatalog?.(id);
              }}
            >
              <ClaySelect.Option value="">Select a catalog…</ClaySelect.Option>
              {catalogs.map((c) => (
                <ClaySelect.Option key={c.id} value={c.id} label={c.name} />
              ))}
            </ClaySelect>
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
              disabled={disabled}
              onChange={(e) => {
                const id = Number(e.target.value) || null;
                onSelectChannel?.(id);
              }}
            >
              <ClaySelect.Option value="">Select a channel…</ClaySelect.Option>
              {channels.map((c) => (
                <ClaySelect.Option key={c.id} value={c.id} label={c.name} />
              ))}
            </ClaySelect>
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
