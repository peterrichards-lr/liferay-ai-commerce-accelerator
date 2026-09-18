import React, { useEffect, useState } from 'react';
import ClayModal, { useModal } from '@clayui/modal';
import ClayButton from '@clayui/button';
import ClayForm, { ClaySelect } from '@clayui/form';
import CheckboxField from '../ui/CheckboxField';
import {
  SELECTABLE_SITE_TYPES,
  catalogCurrency,
  catalogOptionLabel,
  findCatalog,
} from '../../config/commerceSetup';

/**
 * Creates a catalog and/or a channel, from one dialog (#746).
 *
 * One dialog rather than an Add beside each dropdown. Once the catalog owns its
 * currency and a channel's currency has to agree with the catalog backing it,
 * two independent creates are exactly the affordance that lets an operator
 * build a mismatched pair - and a mismatched pair is the defect this whole area
 * exists to close.
 *
 * The two halves ask for different things, so each is a section that can be
 * turned off: a catalog needs a currency and a default language, a channel
 * needs a site and a commerce site type.
 *
 * **Currency is selectable here and nowhere else**, because here is the only
 * place a catalog is created. Creating a channel against an existing catalog
 * takes that catalog's currency, shown and not editable. With no catalog to
 * take it from, the dialog refuses rather than defaulting - nothing is
 * substituted silently (#1014).
 */
function CommerceSetupForm({
  catalogs,
  currencies,
  onClose,
  onCreate,
  onLoadSiteLanguages,
  selectedCatalogId,
  sites,
  submitting,
}) {
  const { observer, onClose: handleClose } = useModal({ onClose });

  const [withCatalog, setWithCatalog] = useState(true);
  const [withChannel, setWithChannel] = useState(true);
  const [siteGroupId, setSiteGroupId] = useState('');
  // Keyed by the site it was loaded for, so a list never outlives the choice it
  // belongs to: an in-flight load would otherwise leave the previous site's
  // locales on screen as though they were the new one's.
  const [loaded, setLoaded] = useState({ items: [], siteGroupId: '' });
  const [catalogName, setCatalogName] = useState('');
  const [catalogCurrencyCode, setCatalogCurrencyCode] = useState('');
  const [catalogLanguageId, setCatalogLanguageId] = useState('');
  const [channelName, setChannelName] = useState('');
  const [channelSiteType, setChannelSiteType] = useState(
    SELECTABLE_SITE_TYPES[0]
  );

  // The card's language list belongs to the selected channel's site, and the
  // instance this dialog exists for has no channel. So the locales come from
  // the site chosen here, which is also the site the channel will be attached
  // to.
  useEffect(() => {
    if (!siteGroupId) return undefined;

    let current = true;

    Promise.resolve(onLoadSiteLanguages?.(siteGroupId)).then((langs) => {
      if (current) {
        setLoaded({ items: Array.isArray(langs) ? langs : [], siteGroupId });
      }
    });

    return () => {
      current = false;
    };
  }, [onLoadSiteLanguages, siteGroupId]);

  const languages = loaded.siteGroupId === siteGroupId ? loaded.items : [];

  const selectedCatalog = findCatalog(catalogs, selectedCatalogId);
  const existingCurrency = catalogCurrency(selectedCatalog);

  // The one answer to "what will this be denominated in", and where it came
  // from. Both are shown, because a currency with no stated source is how an
  // operator ends up unable to tell a choice from a default.
  const effectiveCurrency = withCatalog
    ? String(catalogCurrencyCode).trim()
    : existingCurrency;

  const currencySource = withCatalog
    ? 'the catalog being created'
    : selectedCatalog
      ? `the selected catalog, ${catalogOptionLabel(selectedCatalog)}`
      : null;

  const missing = [];

  if (!withCatalog && !withChannel) {
    missing.push('Choose a catalog, a channel, or both.');
  }

  if (!siteGroupId) {
    missing.push(
      withChannel
        ? 'Choose a site. It is the channel’s site, and the source of the languages a catalog can default to.'
        : 'Choose a site, so the catalog’s default language can be listed.'
    );
  }

  if (withCatalog) {
    if (!catalogName.trim()) missing.push('The catalog needs a name.');
    if (!catalogCurrencyCode) missing.push('The catalog needs a currency.');
    if (!catalogLanguageId) {
      missing.push('The catalog needs a default language.');
    }
  }

  if (withChannel) {
    if (!channelName.trim()) missing.push('The channel needs a name.');
    if (!effectiveCurrency) {
      missing.push(
        'No currency could be determined. A channel takes the currency of the ' +
          'catalog backing it, and no catalog here names one. Create a catalog ' +
          'as well, or select one first - none is chosen for you.'
      );
    }
  }

  const handleSubmit = async () => {
    const result = await onCreate({
      catalog: withCatalog
        ? {
            currencyCode: catalogCurrencyCode,
            defaultLanguageId: catalogLanguageId,
            name: catalogName.trim(),
          }
        : null,
      channel: withChannel
        ? {
            name: channelName.trim(),
            siteGroupId,
            siteType: channelSiteType,
          }
        : null,
    });

    if (result?.success) handleClose();
  };

  return (
    <ClayModal observer={observer} size="lg">
      <ClayModal.Header>Add a catalog or a channel</ClayModal.Header>
      <ClayModal.Body>
        <p className="text-secondary">
          A catalog holds the products and decides what their prices are
          denominated in. A channel is what a storefront browses. They are
          almost always created together, and a channel whose currency does not
          match the catalog behind it displays prices in a currency they were
          never written in - so both are asked for here, with one currency
          between them.
        </p>

        <ClayForm.Group className="mb-4">
          <label htmlFor="setupSite" className="form-label">
            Site
          </label>
          <ClaySelect
            id="setupSite"
            aria-label="Site"
            value={siteGroupId}
            disabled={submitting || sites.length === 0}
            onChange={(e) => {
              setSiteGroupId(e.target.value);
              setCatalogLanguageId('');
            }}
          >
            <ClaySelect.Option
              value=""
              label={sites.length === 0 ? 'No sites found' : 'Select a site…'}
            />
            {sites.map((s) => (
              <ClaySelect.Option key={s.id} value={s.id} label={s.name} />
            ))}
          </ClaySelect>
          <small className="form-text text-muted">
            The channel&rsquo;s site, and the source of the languages a catalog
            can default to. A channel created without a site offers no languages
            and cannot be generated into.
          </small>
        </ClayForm.Group>

        <CheckboxField
          id="setupWithCatalog"
          label="Create a catalog"
          checked={withCatalog}
          onChange={setWithCatalog}
          disabled={submitting}
        />

        {withCatalog && (
          <div className="border rounded p-3 mb-4">
            <ClayForm.Group className="mb-3">
              <label htmlFor="setupCatalogName" className="form-label">
                Catalog name
              </label>
              <input
                id="setupCatalogName"
                className="form-control"
                type="text"
                value={catalogName}
                disabled={submitting}
                onChange={(e) => setCatalogName(e.target.value)}
              />
            </ClayForm.Group>

            <ClayForm.Group className="mb-3">
              <label htmlFor="setupCatalogCurrency" className="form-label">
                Currency
              </label>
              <ClaySelect
                id="setupCatalogCurrency"
                aria-label="Currency"
                value={catalogCurrencyCode}
                disabled={submitting || currencies.length === 0}
                onChange={(e) => setCatalogCurrencyCode(e.target.value)}
              >
                <ClaySelect.Option
                  value=""
                  label={
                    currencies.length === 0
                      ? 'No currencies found'
                      : 'Select a currency…'
                  }
                />
                {currencies.map((c) => (
                  <ClaySelect.Option
                    key={c.code}
                    value={c.code}
                    label={`${c.name} (${c.code})`}
                  />
                ))}
              </ClaySelect>
              <small className="form-text text-muted">
                A catalog&rsquo;s currency cannot be changed afterwards, and
                every price generated into it is written in it.
              </small>
            </ClayForm.Group>

            <ClayForm.Group className="mb-0">
              <label htmlFor="setupCatalogLanguage" className="form-label">
                Default language
              </label>
              <ClaySelect
                id="setupCatalogLanguage"
                aria-label="Default language"
                value={catalogLanguageId}
                disabled={submitting || languages.length === 0}
                onChange={(e) => setCatalogLanguageId(e.target.value)}
              >
                <ClaySelect.Option
                  value=""
                  label={
                    languages.length === 0
                      ? 'Choose a site to list its languages'
                      : 'Select a language…'
                  }
                />
                {languages.map((l) => (
                  <ClaySelect.Option
                    key={l.id}
                    value={l.id}
                    label={l.name || l.id}
                  />
                ))}
              </ClaySelect>
            </ClayForm.Group>
          </div>
        )}

        <CheckboxField
          id="setupWithChannel"
          label="Create a channel"
          checked={withChannel}
          onChange={setWithChannel}
          disabled={submitting}
        />

        {withChannel && (
          <div className="border rounded p-3 mb-3">
            <ClayForm.Group className="mb-3">
              <label htmlFor="setupChannelName" className="form-label">
                Channel name
              </label>
              <input
                id="setupChannelName"
                className="form-control"
                type="text"
                value={channelName}
                disabled={submitting}
                onChange={(e) => setChannelName(e.target.value)}
              />
            </ClayForm.Group>

            <ClayForm.Group className="mb-3">
              <label className="form-label" htmlFor="setupChannelCurrency">
                Currency (from the catalog)
              </label>
              <input
                id="setupChannelCurrency"
                className="form-control"
                type="text"
                readOnly
                value={effectiveCurrency || ''}
              />
              <small className="form-text text-muted">
                {effectiveCurrency
                  ? `Taken from ${currencySource}. A channel's currency is not ` +
                    'chosen separately, because the prices are written in the ' +
                    "catalog's."
                  : 'No currency, because no catalog here names one. Create a ' +
                    'catalog as well, or select one first.'}
              </small>
            </ClayForm.Group>

            <ClayForm.Group className="mb-0">
              <label htmlFor="setupChannelSiteType" className="form-label">
                Commerce site type
              </label>
              <ClaySelect
                id="setupChannelSiteType"
                aria-label="Commerce site type"
                value={channelSiteType}
                disabled={submitting}
                onChange={(e) => setChannelSiteType(e.target.value)}
              >
                {SELECTABLE_SITE_TYPES.map((type) => (
                  <ClaySelect.Option key={type} value={type} label={type} />
                ))}
              </ClaySelect>
              <small className="form-text text-muted">
                Decides which account types the channel accepts. It is set after
                the channel is created and then read back, so if it does not
                take you will be told rather than left to find out when a run is
                refused.
              </small>
            </ClayForm.Group>
          </div>
        )}

        {missing.length > 0 && (
          <div className="alert alert-warning mb-0" role="alert">
            <ul className="mb-0 pl-4">
              {missing.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
      </ClayModal.Body>
      <ClayModal.Footer
        last={
          <ClayButton.Group spaced>
            <ClayButton
              displayType="secondary"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </ClayButton>
            <ClayButton
              displayType="primary"
              disabled={submitting || missing.length > 0}
              onClick={handleSubmit}
            >
              {submitting ? 'Creating…' : 'Create'}
            </ClayButton>
          </ClayButton.Group>
        }
      />
    </ClayModal>
  );
}

export default function CommerceSetupDialog({ visible, ...props }) {
  if (!visible) return null;

  return <CommerceSetupForm {...props} />;
}
