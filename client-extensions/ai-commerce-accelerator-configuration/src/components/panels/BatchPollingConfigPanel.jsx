import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { getKeyValue, persistConfigKey } from '../../utils/api';

const BATCH_POLLING_KEY = 'batch-polling-config';

const DEFAULTS = {
  pollInterval: 5000, // ms
  minPollInterval: 2000, // ms
  maxPollAttempts: 120,
  maxRetries: 3,
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

export default function BatchPollingConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState([]);

  const [values, setValues] = useState(DEFAULTS);
  const [lastSaved, setLastSaved] = useState(DEFAULTS);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(lastSaved),
    [values, lastSaved]
  );

  // Load config
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const raw = await getKeyValue(BATCH_POLLING_KEY);
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = {};
        }
        const merged = {
          pollInterval: toInt(parsed.pollInterval, DEFAULTS.pollInterval),
          minPollInterval: toInt(
            parsed.minPollInterval,
            DEFAULTS.minPollInterval
          ),
          maxPollAttempts: toInt(
            parsed.maxPollAttempts,
            DEFAULTS.maxPollAttempts
          ),
          maxRetries: toInt(parsed.maxRetries, DEFAULTS.maxRetries),
        };
        if (!alive) return;
        setValues(merged);
        setLastSaved(merged);
      } catch (e) {
        Liferay?.Util?.openToast?.({
          message: 'Failed to load batch polling config.',
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

  // Before unload warning
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Cmd/Ctrl+S to save
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

  const estimatedDurationMs = useMemo(() => {
    const { pollInterval, maxPollAttempts } = values;
    return Number.isFinite(pollInterval) && Number.isFinite(maxPollAttempts)
      ? Math.max(0, pollInterval) * Math.max(0, maxPollAttempts)
      : 0;
  }, [values]);

  // Validation
  useEffect(() => {
    const found = [];
    const { pollInterval, minPollInterval, maxPollAttempts, maxRetries } =
      values;

    if (!Number.isFinite(pollInterval) || pollInterval <= 0)
      found.push('Poll interval must be a positive number (ms).');
    if (!Number.isFinite(minPollInterval) || minPollInterval <= 0)
      found.push('Minimum poll interval must be a positive number (ms).');
    if (
      Number.isFinite(pollInterval) &&
      Number.isFinite(minPollInterval) &&
      pollInterval < minPollInterval
    )
      found.push(
        'Poll interval must be greater than or equal to the minimum poll interval.'
      );

    if (!Number.isFinite(maxPollAttempts) || maxPollAttempts < 1)
      found.push('Max poll attempts must be at least 1.');
    if (!Number.isFinite(maxRetries) || maxRetries < 0)
      found.push('Max retries cannot be negative.');

    if (
      Number.isFinite(estimatedDurationMs) &&
      estimatedDurationMs > 1000 * 60 * 60 * 3
    ) {
      found.push(
        'Warning: Total polling window exceeds 3 hours. Consider lowering attempts or interval.'
      );
    }

    setIssues(found);
  }, [values, estimatedDurationMs]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = JSON.stringify(values);
      await persistConfigKey(BATCH_POLLING_KEY, payload);
      setLastSaved(values);
      Liferay?.Util?.openToast?.({
        message: 'Batch polling configuration saved.',
        type: 'success',
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      Liferay?.Util?.openToast?.({
        message: 'Failed to save batch polling configuration.',
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
        <h2 className="sheet-title">Batch Polling</h2>
        <div className="sheet-text">
          Stored under <code>{BATCH_POLLING_KEY}</code> as JSON:{' '}
          <code>
            {'{ pollInterval, minPollInterval, maxPollAttempts, maxRetries }'}
          </code>
          .
          <div className="mt-1">
            Estimated total polling window:{' '}
            <strong>{msToHHMMSS(estimatedDurationMs)}</strong>
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
          <label htmlFor="poll-interval" className="font-weight-semi-bold">
            Poll interval (ms)
          </label>
          <ClayInput
            id="poll-interval"
            type="number"
            min={1}
            step={100}
            value={values.pollInterval}
            onChange={onNumberChange('pollInterval')}
          />
          <small className="form-text text-secondary">
            How long to wait between each poll attempt.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="min-poll-interval" className="font-weight-semi-bold">
            Minimum poll interval (ms)
          </label>
          <ClayInput
            id="min-poll-interval"
            type="number"
            min={1}
            step={100}
            value={values.minPollInterval}
            onChange={onNumberChange('minPollInterval')}
          />
          <small className="form-text text-secondary">
            Lower bound for adaptive backoff—actual interval should never dip
            below this.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="max-poll-attempts" className="font-weight-semi-bold">
            Max poll attempts
          </label>
          <ClayInput
            id="max-poll-attempts"
            type="number"
            min={1}
            step={1}
            value={values.maxPollAttempts}
            onChange={onNumberChange('maxPollAttempts')}
          />
          <small className="form-text text-secondary">
            Ceiling on how many polls to perform before giving up.
          </small>
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
            onChange={onNumberChange('maxRetries')}
          />
          <small className="form-text text-secondary">
            How many times the batch job may be re-run upon failure.
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
              saving
                ? 'Saving batch polling configuration…'
                : 'Save batch polling configuration'
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
