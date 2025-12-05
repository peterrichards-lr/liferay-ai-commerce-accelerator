import { useEffect, useMemo } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import MillisecondsInput from '../common/MillisecondsInput';
import { useForm, useObjectStorage } from '../../hooks';
import { msToHHMMSS } from '../../utils/helper';

const CACHE_CONFIG_KEY = 'cache-config';

const DEFAULTS = {
  [CACHE_CONFIG_KEY]: {
    maxSize: 1000,
    defaultTTL: 3600000,
    cleanupInterval: 60000,
    configTTL: 3600000,
    apiResponseTTL: 300000,
    defaultBatchTTL: 3600000,
    sessionTTL: 1800000,
    ephemeralTTL: 300000,
    uploadTTL: 900000,
    ercConfigTTL: 3600000,
  },
};

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

export default function CacheConfigPanel() {
  const [issues, setIssues] = useState([]);

  const {
    loading,
    saving,
    values: { [CACHE_CONFIG_KEY]: values },
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys: [CACHE_CONFIG_KEY],
    defaults: DEFAULTS,
  });

  useForm({ dirty, onSave });

  const onNumberChange = (key) => (e) => {
    const next = toInt(e.target.value, values[key]);
    setValue(CACHE_CONFIG_KEY, { ...values, [key]: next });
  };

  const approxCapacityKB = useMemo(() => {
    const avgEntryBytes = 1024;
    return Math.round((values.maxSize * avgEntryBytes) / 1024);
  }, [values.maxSize]);

  useEffect(() => {
    const found = [];
    const {
      maxSize,
      defaultTTL,
      cleanupInterval,
      configTTL,
      apiResponseTTL,
      defaultBatchTTL,
      sessionTTL,
      ephemeralTTL,
      uploadTTL,
      ercConfigTTL,
    } = values;

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

    if (!Number.isFinite(defaultBatchTTL) || defaultBatchTTL < 60000)
      found.push('Default batch TTL must be ≥ 60000 ms (1 minute).');

    if (!Number.isFinite(sessionTTL) || sessionTTL < 60000)
      found.push('Session TTL must be ≥ 60000 ms (1 minute).');

    if (!Number.isFinite(ephemeralTTL) || ephemeralTTL < 1000)
      found.push('Ephemeral TTL must be ≥ 1000 ms (1 second).');

    if (!Number.isFinite(uploadTTL) || uploadTTL < 60000)
      found.push('Upload TTL must be ≥ 60000 ms (1 minute).');

    if (!Number.isFinite(ercConfigTTL) || ercConfigTTL < 60000)
      found.push('ERC config TTL must be ≥ 60000 ms (1 minute).');

    setIssues(found);
  }, [values]);

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">Cache</h2>
        <div className="sheet-text">
          Stored under <code>{CACHE_CONFIG_KEY}</code> as JSON:{' '}
          <code>
            {'{ maxSize, defaultTTL, cleanupInterval, configTTL, apiResponseTTL, defaultBatchTTL, sessionTTL, ephemeralTTL, uploadTTL, ercConfigTTL }'}
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

        <MillisecondsInput
          id="default-ttl"
          label="Default TTL (ms)"
          value={values.defaultTTL}
          min={60000}
          step={1000}
          onChange={onNumberChange('defaultTTL')}
          helper="Time-to-live for entries when no specific TTL is provided."
        />

        <MillisecondsInput
          id="cleanup-interval"
          label="Cleanup interval (ms)"
          value={values.cleanupInterval}
          min={5000}
          step={1000}
          onChange={onNumberChange('cleanupInterval')}
          helper="How often to purge expired entries."
        />

        <MillisecondsInput
          id="config-ttl"
          label="Config cache TTL (ms)"
          value={values.configTTL}
          min={60000}
          step={1000}
          onChange={onNumberChange('configTTL')}
          helper="TTL for configuration entries cached in the service."
        />

        <MillisecondsInput
          id="api-ttl"
          label="API response TTL (ms)"
          value={values.apiResponseTTL}
          min={1000}
          step={1000}
          onChange={onNumberChange('apiResponseTTL')}
          helper="TTL for cached HTTP responses."
        />

        <MillisecondsInput
          id="default-batch-ttl"
          label="Default batch TTL (ms)"
          value={values.defaultBatchTTL}
          min={60000}
          step={1000}
          onChange={onNumberChange('defaultBatchTTL')}
          helper="TTL for batch operations when no specific TTL is provided."
        />

        <MillisecondsInput
          id="session-ttl"
          label="Session TTL (ms)"
          value={values.sessionTTL}
          min={60000}
          step={1000}
          onChange={onNumberChange('sessionTTL')}
          helper="TTL for cached session data."
        />

        <MillisecondsInput
          id="ephemeral-ttl"
          label="Ephemeral TTL (ms)"
          value={values.ephemeralTTL}
          min={1000}
          step={1000}
          onChange={onNumberChange('ephemeralTTL')}
          helper="TTL for short-lived ephemeral entries."
        />

        <MillisecondsInput
          id="upload-ttl"
          label="Upload TTL (ms)"
          value={values.uploadTTL}
          min={60000}
          step={1000}
          onChange={onNumberChange('uploadTTL')}
          helper="TTL for cached upload-related entries."
        />

        <MillisecondsInput
          id="erc-config-ttl"
          label="ERC config TTL (ms)"
          value={values.ercConfigTTL}
          min={60000}
          step={1000}
          onChange={onNumberChange('ercConfigTTL')}
          helper="TTL for external reference code configuration entries."
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