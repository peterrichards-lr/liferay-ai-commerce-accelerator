import { useEffect, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';

const EXPIRY_KEY = 'catalog-expiry-config';

const DEFAULTS = {
  [EXPIRY_KEY]: {
    neverExpire: true,
    expiryDays: 30,
  },
};

function toInt(value, fallback) {
  const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function CatalogExpiryPanel() {
  const [issues, setIssues] = useState([]);

  const {
    loading,
    saving,
    values: { [EXPIRY_KEY]: values },
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys: [EXPIRY_KEY],
    defaults: DEFAULTS,
  });

  useForm({ dirty, onSave });

  const setField = (key, value) =>
    setValue(EXPIRY_KEY, { ...values, [key]: value });

  useEffect(() => {
    const found = [];
    const { expiryDays } = values;

    if (!Number.isFinite(expiryDays) || expiryDays < 1) {
      found.push('Expiry days must be a whole number of at least 1.');
    }

    setIssues(found);
  }, [values]);

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">Catalog Expiry</h2>
        <div className="sheet-text">
          How long a generated catalog stays purchasable. Applies to the
          products and SKUs a generation run creates, not to anything already in
          the catalog. Stored under <code>{EXPIRY_KEY}</code>.
        </div>
      </div>

      {!!issues.length && (
        <ClayAlert
          displayType="warning"
          title="Please review"
          role="alert"
          aria-live="assertive"
          className="mb-3"
        >
          <ul className="my-2">
            {issues.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </ClayAlert>
      )}

      <div className="sheet-section">
        <ClayForm.Group>
          <div className="custom-control custom-checkbox mb-3">
            <input
              type="checkbox"
              className="custom-control-input"
              id="never-expire"
              checked={values.neverExpire !== false}
              onChange={(event) =>
                setField('neverExpire', event.target.checked)
              }
            />
            <label className="custom-control-label" htmlFor="never-expire">
              Generated products and SKUs never expire
            </label>
          </div>
          <small className="form-text text-secondary">
            Leave this on for a demo bundle that has to keep working. Turn it
            off for a shared sandbox that should clean itself up, and set the
            window below.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="expiry-days" className="font-weight-semi-bold">
            Expiry Window (days)
          </label>
          <ClayInput
            id="expiry-days"
            type="number"
            min={1}
            step={1}
            disabled={values.neverExpire !== false}
            value={values.expiryDays}
            onChange={(event) =>
              setField(
                'expiryDays',
                toInt(event.target.value, values.expiryDays)
              )
            }
          />
          <small className="form-text text-secondary">
            Days from the moment a run starts until its products and SKUs stop
            being purchasable. Ignored while the option above is on.
          </small>
        </ClayForm.Group>
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={!dirty || saving || issues.length > 0}
            aria-disabled={!dirty || saving || issues.length > 0}
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />
            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>

          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
            aria-disabled={!dirty || saving}
          >
            <ClayIcon symbol="restore" />
            <span className="ml-2">Cancel</span>
          </ClayButton>
        </div>
      </div>
    </ClayLayout.Sheet>
  );
}
