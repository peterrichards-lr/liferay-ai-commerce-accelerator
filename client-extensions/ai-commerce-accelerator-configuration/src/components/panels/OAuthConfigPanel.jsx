import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { getKeyValue, persistConfigKey } from '../../utils/api';

const OAUTH_KEY = 'oauth-config';

const DEFAULTS = {
  httpTimeoutMs: 15000,
  maxRetries: 2,
  backoffBaseMs: 500,
  tokenSkewSec: 60,
  tokenCacheTtlMs: 3600000,
};

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

export default function OAuthConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState([]);
  const [values, setValues] = useState(DEFAULTS);
  const [lastSaved, setLastSaved] = useState(DEFAULTS);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(lastSaved),
    [values, lastSaved]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const raw = await getKeyValue(OAUTH_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const merged = {
          httpTimeoutMs: toInt(parsed.httpTimeoutMs, DEFAULTS.httpTimeoutMs),
          maxRetries: toInt(parsed.maxRetries, DEFAULTS.maxRetries),
          backoffBaseMs: toInt(parsed.backoffBaseMs, DEFAULTS.backoffBaseMs),
          tokenSkewSec: toInt(parsed.tokenSkewSec, DEFAULTS.tokenSkewSec),
          tokenCacheTtlMs: toInt(
            parsed.tokenCacheTtlMs,
            DEFAULTS.tokenCacheTtlMs
          ),
        };
        if (!alive) return;
        setValues(merged);
        setLastSaved(merged);
      } catch {
        Liferay?.Util?.openToast?.({
          message: 'Failed to load OAuth configuration.',
          type: 'danger',
        });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onKey = (e) => {
      const key = e.key?.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await persistConfigKey(OAUTH_KEY, JSON.stringify(values));
      setLastSaved(values);
      Liferay?.Util?.openToast?.({
        message: 'OAuth configuration saved.',
        type: 'success',
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      Liferay?.Util?.openToast?.({
        message: 'Failed to save OAuth configuration.',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }, [saving, values]);

  const onCancel = useCallback(() => setValues(lastSaved), [lastSaved]);

  const onNumberChange = (key, min) => (e) => {
    const next = toInt(e.target.value, values[key]);
    setValues((v) => ({ ...v, [key]: Math.max(min ?? -Infinity, next) }));
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
        <ClayForm.Group>
          <label htmlFor="http-timeout" className="font-weight-semi-bold">
            HTTP timeout (ms)
          </label>
          <ClayInput
            id="http-timeout"
            type="number"
            min={1000}
            step={500}
            value={values.httpTimeoutMs}
            onChange={onNumberChange('httpTimeoutMs', 1000)}
          />
        </ClayForm.Group>

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

        <ClayForm.Group>
          <label htmlFor="backoff-base" className="font-weight-semi-bold">
            Backoff base (ms)
          </label>
          <ClayInput
            id="backoff-base"
            type="number"
            min={100}
            step={50}
            value={values.backoffBaseMs}
            onChange={onNumberChange('backoffBaseMs', 100)}
          />
        </ClayForm.Group>

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

        <ClayForm.Group>
          <label htmlFor="token-cache-ttl" className="font-weight-semi-bold">
            Token cache TTL (ms)
          </label>
          <ClayInput
            id="token-cache-ttl"
            type="number"
            min={60000}
            step={60000}
            value={values.tokenCacheTtlMs}
            onChange={onNumberChange('tokenCacheTtlMs', 60000)}
          />
        </ClayForm.Group>
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