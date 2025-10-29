import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { getKeyValue, persistConfigKey } from '../../utils/api';

const CACHE_CONFIG_KEY = 'cache-config';

const DEFAULTS = {
  maxSize: 1000,
  defaultTTL: 3600000,      // 60 min
  cleanupInterval: 60000,   // 1 min
  configTTL: 3600000,       // 60 min
  apiResponseTTL: 300000,   // 5 min
};

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

function msToHHMMSS(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function CacheConfigPanel() {
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
        const raw = await getKeyValue(CACHE_CONFIG_KEY);
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = {};
        }
        const merged = {
          maxSize: toInt(parsed.maxSize, DEFAULTS.maxSize),
          defaultTTL: toInt(parsed.defaultTTL, DEFAULTS.defaultTTL),
          cleanupInterval: toInt(parsed.cleanupInterval, DEFAULTS.cleanupInterval),
          configTTL: toInt(parsed.configTTL, DEFAULTS.configTTL),
          apiResponseTTL: toInt(parsed.apiResponseTTL, DEFAULTS.apiResponseTTL),
        };
        if (!alive) return;
        setValues(merged);
        setLastSaved(merged);
      } catch (e) {
        Liferay?.Util?.openToast?.({
          message: 'Failed to load cache configuration.',
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

  const approxCapacityKB = useMemo(() => {
    // very rough viz: average entry ~ 1KB -> show max entries as KB
    const avgEntryBytes = 1024;
    return Math.round((values.maxSize * avgEntryBytes) / 1024);
  }, [values.maxSize]);

  useEffect(() => {
    const found = [];
    const { maxSize, defaultTTL, cleanupInterval, configTTL, apiResponseTTL } =
      values;

    if (!Number.isFinite(maxSize) || maxSize < 100)
      found.push('Max size must be at least 100 entries.');

    if (!Number.isFinite(defaultTTL) || defaultTTL < 60000)
      found.push('Default TTL must be ≥ 60000 ms (1 minute).');

    if (!Number.isFinite(cleanupInterval) || cleanupInterval < 5000)
      found.push('Cleanup interval must be ≥ 5000 ms (5 seconds).');

    if (!Number.isFinite(configTTL) || configTTL < 60000)
      found.push('Config TTL must be ≥ 60000 ms (1 minute).');

    if (!Number.isFinite(apiResponseTTL) || apiResponseTTL < 1000)
      found.push('API response TTL must be ≥ 1000 ms (1 second).');

    if (
      Number.isFinite(cleanupInterval) &&
      Number.isFinite(defaultTTL) &&
      cleanupInterval > defaultTTL
    ) {
      found.push('Cleanup interval should not exceed the default TTL.');
    }

    setIssues(found);
  }, [values]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = JSON.stringify(values);
      await persistConfigKey(CACHE_CONFIG_KEY, payload);
      setLastSaved(values);
      Liferay?.Util?.openToast?.({
        message: 'Cache configuration saved.',
        type: 'success',
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      Liferay?.Util?.openToast?.({
        message: 'Failed to save cache configuration.',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }, [saving, values]);

  const onCancel = useCallback(() => setValues(lastSaved), [lastSaved]);

  const onNumberChange = (key) => (e) => {
    const next = toInt(e.target.value, values[key]);
    setValues((v) => ({ ...v, [key]: next }));
  };

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">Cache</h2>
        <div className="sheet-text">
          Stored under <code>{CACHE_CONFIG_KEY}</code> as JSON:{' '}
          <code>
            {'{ maxSize, defaultTTL, cleanupInterval, configTTL, apiResponseTTL }'}
          </code>
          .
          <div className="mt-1">
            Default TTL:{' '}
            <strong>{msToHHMMSS(values.defaultTTL)}</strong> · Cleanup every{' '}
            <strong>{msToHHMMSS(values.cleanupInterval)}</strong> · Approx. capacity:{' '}
            <strong>{approxCapacityKB} KB</strong>
          </div>
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
            {issues.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </ClayAlert>
      )}

      <div className="sheet-section">
        <ClayForm.Group>
          <label htmlFor="max-size" className="font-weight-semi-bold">
            Max size (entries)
          </label>
          <ClayInput
            id="max-size"
            type="number"
            min={100}
            step={50}
            value={values.maxSize}
            onChange={onNumberChange('maxSize')}
          />
          <small className="form-text text-secondary">
            Maximum number of entries retained in memory.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="default-ttl" className="font-weight-semi-bold">
            Default TTL (ms)
          </label>
          <ClayInput
            id="default-ttl"
            type="number"
            min={60000}
            step={1000}
            value={values.defaultTTL}
            onChange={onNumberChange('defaultTTL')}
          />
          <small className="form-text text-secondary">
            Time-to-live for entries when no specific TTL is provided.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="cleanup-interval" className="font-weight-semi-bold">
            Cleanup interval (ms)
          </label>
          <ClayInput
            id="cleanup-interval"
            type="number"
            min={5000}
            step={1000}
            value={values.cleanupInterval}
            onChange={onNumberChange('cleanupInterval')}
          />
          <small className="form-text text-secondary">
            How often to purge expired entries.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="config-ttl" className="font-weight-semi-bold">
            Config cache TTL (ms)
          </label>
          <ClayInput
            id="config-ttl"
            type="number"
            min={60000}
            step={1000}
            value={values.configTTL}
            onChange={onNumberChange('configTTL')}
          />
          <small className="form-text text-secondary">
            TTL for configuration entries cached in the service.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="api-ttl" className="font-weight-semi-bold">
            API response TTL (ms)
          </label>
          <ClayInput
            id="api-ttl"
            type="number"
            min={1000}
            step={1000}
            value={values.apiResponseTTL}
            onChange={onNumberChange('apiResponseTTL')}
          />
          <small className="form-text text-secondary">
            TTL for cached HTTP responses.
          </small>
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
            aria-disabled={
              !dirty || saving || issues.some((m) => !m.startsWith('Warning:'))
            }
            aria-label={
              saving ? 'Saving cache configuration…' : 'Save cache configuration'
            }
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />
            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>

          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
            aria-disabled={!dirty || saving}
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