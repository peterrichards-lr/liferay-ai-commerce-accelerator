import React, { useEffect, useState } from 'react';
import { channelOptionLabel } from '../../config/channelSiteType';
import {
  catalogCurrency,
  catalogOptionLabel,
  findCatalog,
} from '../../config/commerceSetup';
import ClayCard from '@clayui/card';
import ClayForm, { ClaySelect } from '@clayui/form';
import { useApp } from '../../context/AppContext';
import CommerceSetupDialog from './CommerceSetupDialog';
import FieldError from '../ui/FieldError';
import CheckboxField from '../ui/CheckboxField';
import { commerceChannelsUrl } from '../../utils/liferayLinks';
import notifyUser from '../../utils/notifications';

/**
 * Fills in a catalog or channel once the lists are loaded.
 *
 * Two cases, and they are not the same. Nothing selected is a convenience
 * default and stays quiet. A selection that the instance does not have - an
 * imported config, or an id left behind by a database reset - is a signal that
 * the user's view is out of date, and replacing it without a word is how a
 * generation run ends up in a catalog nobody chose. That one is announced. See
 * #680.
 */
function autoSelect({ items, label, onSelect, selectedId, skip }) {
  if (skip || items.length === 0) return;

  if (!selectedId) {
    onSelect?.(String(items[0].id));
    return;
  }

  if (items.some((item) => String(item.id) === String(selectedId))) return;

  const replacement = items[0];

  notifyUser(
    `${label} id ${selectedId} is not on this instance. Switched to '${replacement.name}' (id ${replacement.id}) - check this is what you want before generating.`,
    'warning'
  );

  onSelect?.(String(replacement.id));
}

export default function CommerceCard({
  disabled,
  catalogs = [],
  channels = [],
  languages = [],
  currencies = [],
  sites = [],
  connected = false,
  onSelectChannel,
  onSelectCatalog,
  isCreatingCommerce = false,
  onCreateCommerceSetup,
  onLoadSiteLanguages,
  onRefresh,
  commerceConfigured,
  errors,
}) {
  const { config, setConfig } = useApp();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);

  // The catalog is what price lists are written into, so its currency is what
  // they are denominated in. It used to be invisible here - the dropdown showed
  // only the name - which is how a run generated euro price lists into a dollar
  // catalog without anything on screen saying so (#746).
  const selectedCatalog = findCatalog(catalogs, config.catalogId);
  const runCurrency = catalogCurrency(selectedCatalog);

  // Portal-scoped, so no site to resolve. Null when the configured base URL is
  // unusable, in which case the note below renders as plain text rather than a
  // dead link. A specific channel's edit screen cannot be linked: it needs
  // p_auth, a per-session token.
  const channelsUrl = commerceChannelsUrl(config?.liferayUrl);

  // Languages come from the channel's *site*, not from the channel, and a
  // channel can exist without one - `get-languages` requires a siteGroupId and
  // throws without it, and the retry effect never even attempts the load. The
  // result was an empty list reading "No languages found", which is true and
  // says nothing about why (#639).
  //
  // Note this is a different group from the one the commerce site type is read
  // on: that is the channel's own group, which always exists, which is why the
  // site type resolves while languages do not.
  const selectedChannel = channels.find(
    (channel) => String(channel.id) === String(config.channelId)
  );

  // Absent only counts once a channel is actually selected and found. Liferay
  // may report 0 or omit the field for a channel created without a site, so
  // both read as absent.
  const channelHasNoSite = Boolean(
    config.channelId && selectedChannel && !selectedChannel.siteGroupId
  );

  // Two currencies that must agree: the catalog's, which the prices are written
  // in, and the channel's, which the storefront displays. Nothing reconciles
  // them, so a disagreement is named rather than resolved.
  const channelCurrency = String(selectedChannel?.currencyCode ?? '').trim();
  const currencyMismatch = Boolean(
    runCurrency && channelCurrency && runCurrency !== channelCurrency
  );

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
    selectedCatalog,
    config.selectedLanguages,
    setConfig,
  ]);

  useEffect(() => {
    autoSelect({
      label: 'Catalog',
      items: catalogs,
      onSelect: onSelectCatalog,
      selectedId: config.catalogId,
      skip: !connected,
    });
  }, [connected, catalogs, config.catalogId, onSelectCatalog]);

  useEffect(() => {
    autoSelect({
      label: 'Channel',
      items: channels,
      onSelect: onSelectChannel,
      selectedId: config.channelId,
      skip: !connected,
    });
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
                    // Labelled with the currency, because that is what every
                    // price generated into the catalog is denominated in and
                    // the one value the operator could not see (#746).
                    ...catalogs.map((c) => (
                      <ClaySelect.Option
                        key={c.id}
                        value={c.id}
                        label={catalogOptionLabel(c)}
                      />
                    )),
                  ]}
            </ClaySelect>
            {connected && catalogs.length === 0 && (
              <small className="text-danger d-block mt-1">
                No catalogs found. Add one below, or create it in Liferay.
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
                    // Labelled with the site type, so the choice of channel
                    // and the choice of account type can be made together
                    // rather than one being corrected after the other. See
                    // #610.
                    ...channels.map((c) => (
                      <ClaySelect.Option
                        key={c.id}
                        value={c.id}
                        label={channelOptionLabel(c)}
                      />
                    )),
                  ]}
            </ClaySelect>
            {connected && channels.length === 0 && (
              <small className="text-danger d-block mt-1">
                No channels found. Add one below, or create it in Liferay.
              </small>
            )}
            <FieldError errors={errors.channelId} />
          </ClayForm.Group>

          {/* One button and one dialog, not an Add beside each dropdown, and
              never gated on a list being empty. The catalog owns the currency
              and a channel's has to agree with the catalog behind it, so two
              independent creates are the affordance that makes a mismatched
              pair - which is the defect this replaces the rescue button to
              close (#746). */}
          <div className="d-flex align-items-center mb-3">
            <button
              type="button"
              className="btn btn-sm btn-secondary px-3 mr-2"
              onClick={handleRefresh}
              disabled={disabled || isRefreshing || isCreatingCommerce}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh Lists'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary px-3"
              onClick={() => setIsSetupOpen(true)}
              disabled={disabled || isRefreshing || isCreatingCommerce}
            >
              {isCreatingCommerce ? 'Creating…' : 'Add catalog or channel'}
            </button>
          </div>

          <small className="text-secondary d-block mb-3">
            Renaming, deleting or re-pointing an existing catalog or channel is
            not done here. That is in{' '}
            {channelsUrl ? (
              <a href={channelsUrl} target="_blank" rel="noopener noreferrer">
                Commerce → Channels
              </a>
            ) : (
              'Liferay under Commerce → Channels'
            )}
            .
          </small>

          <CommerceSetupDialog
            visible={isSetupOpen}
            catalogs={catalogs}
            currencies={currencies}
            sites={sites}
            selectedCatalogId={config.catalogId}
            submitting={isCreatingCommerce}
            onLoadSiteLanguages={onLoadSiteLanguages}
            onCreate={onCreateCommerceSetup}
            onClose={() => setIsSetupOpen(false)}
          />

          <div className="row mt-4">
            <div className="col-12 mb-4">
              <ClayForm.Group className="mb-0">
                <label
                  htmlFor="currencyCode"
                  className="form-label font-weight-semi-bold"
                >
                  Currency
                </label>
                {/* Derived, not chosen. The field had two writers and no owner:
                    the run's currency is what price lists are denominated in,
                    those lists are written into the *catalog*, and the channel
                    was the one supplying the number. Giving it an owner is what
                    removes the ambiguity - so this shows the catalog's, and a
                    different currency is chosen by creating a catalog in it
                    (#746). */}
                <input
                  id="currencyCode"
                  aria-label="Currency"
                  className="form-control"
                  type="text"
                  readOnly
                  value={config.currencyCode || ''}
                />
                <small className="form-text text-muted">
                  {selectedCatalog
                    ? runCurrency
                      ? `From the catalog ${selectedCatalog.name}, which is what every price generated into it is written in.`
                      : `The catalog ${selectedCatalog.name} reports no currency, so nothing here is derived from it.`
                    : 'Select a catalog, or add one, to settle the currency. It is not chosen separately.'}
                </small>
                {currencyMismatch && (
                  <small className="text-danger d-block mt-1">
                    The catalog is in <strong>{runCurrency}</strong> and the
                    channel is in <strong>{channelCurrency}</strong>. Prices are
                    written in the catalog&rsquo;s currency and the storefront
                    displays the channel&rsquo;s, so this run would price in{' '}
                    {runCurrency} and show {channelCurrency}. Choose a channel
                    in {runCurrency}, or add one.
                  </small>
                )}
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
                      : channelHasNoSite
                        ? 'Languages come from the channel\u2019s site, and this channel has none. Attach it to a site in Commerce, or choose a channel that has one.'
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
