import { useEffect, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';
import MillisecondsInput from '../common/MillisecondsInput';

const OAUTH_KEY = 'oauth-config';

const DEFAULTS = {
  [OAUTH_KEY]: {
    httpTimeoutMs: 15000,
    maxRetries: 2,
    backoffBaseMs: 500,
    tokenSkewSec: 60,
    tokenCacheTtlMs: 3600000,
  },
};

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

export default function OAuthConfigPanel() {
  const [issues, setIssues] = useState([]);

  const {
    loading,
    saving,
    values: { [OAUTH_KEY]: values },
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys: [OAUTH_KEY],
    defaults: DEFAULTS,
  });

  useForm({ dirty, onSave });

  useEffect(() => {
    const found = [];
    if (!Number.isFinite(values.httpTimeoutMs) || values.httpTimeoutMs < 1000)
      found.push('HTTP timeout must be ≥ 1000 ms.');
    if (!Number.isFinite(values.maxRetries) || values.maxRetries < 0)
      found.push('Max retries cannot be negative.');
    if (!Number.isFinite(values.backoffBaseMs) || values.backoffBaseMs < 100)
      found.push('Backoff base must be ≥ 100 ms.');
    if (!Number.isFinite(values.tokenSkewSec) || values.tokenSkewSec < 0)
      found.push('Token skew seconds cannot be negative.');
    if (
      !Number.isFinite(values.tokenCacheTtlMs) ||
      values.tokenCacheTtlMs < 60000
    )
      found.push('Token cache TTL must be ≥ 60000 ms.');
    setIssues(found);
  }, [values]);

  const onNumberChange = (key, min) => (e) => {
    const next = toInt(e.target.value, values[key]);
    setValue(OAUTH_KEY, { ...values, [key]: Math.max(min ?? -Infinity, next) });
  };

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">OAuth Settings</h2>
        <div className="sheet-text">
          Stored under <code>{OAUTH_KEY}</code>.
        </div>
      </div>

      {!!issues.length && (
        <ClayAlert displayType="warning" title="Please review" role="alert">
          <ul className="my-2">
            {issues.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </ClayAlert>
      )}

      <div className="sheet-section">
        <MillisecondsInput
          id="http-timeout"
          label="HTTP timeout (ms)"
          value={values.httpTimeoutMs}
          min={1000}
          step={500}
          onChange={onNumberChange('httpTimeoutMs', 1000)}
          helper="Maximum time to wait for an OAuth HTTP call before aborting."
        />

        <ClayForm.Group>
          <label htmlFor="max-retries" className="font-weight-semi-bold">
            Max retries
          </label>
          <ClayInput
            id="max-retries"
            type="number"
            min={0}
            step={1}
            value={values.maxRetries}
            onChange={onNumberChange('maxRetries', 0)}
          />
        </ClayForm.Group>

        <MillisecondsInput
          id="backoff-base"
          label="Backoff base (ms)"
          value={values.backoffBaseMs}
          min={100}
          step={50}
          onChange={onNumberChange('backoffBaseMs', 100)}
          helper="Initial delay used for exponential backoff."
        />

        <ClayForm.Group>
          <label htmlFor="token-skew" className="font-weight-semi-bold">
            Token skew (seconds)
          </label>
          <ClayInput
            id="token-skew"
            type="number"
            min={0}
            step={1}
            value={values.tokenSkewSec}
            onChange={onNumberChange('tokenSkewSec', 0)}
          />
          <small className="form-text text-secondary">
            Subtracted from <code>expires_in</code> to refresh early.
          </small>
        </ClayForm.Group>

        <MillisecondsInput
          id="token-cache-ttl"
          label="Token cache TTL (ms)"
          value={values.tokenCacheTtlMs}
          min={60000}
          step={60000}
          onChange={onNumberChange('tokenCacheTtlMs', 60000)}
          helper="How long an OAuth token is cached before forced refresh."
        />
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={
              !dirty || saving || issues.some((m) => !m.startsWith('Warning:'))
            }
            aria-label="Save OAuth configuration"
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />
            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>

          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
            aria-label="Cancel changes"
          >
            <ClayIcon symbol="restore" />
            <span className="ml-2">Cancel</span>
          </ClayButton>
        </div>
      </div>
    </ClayLayout.Sheet>
  );
}
