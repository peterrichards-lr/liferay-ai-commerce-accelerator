import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';
import { getKeyValue, persistConfigKey } from '../../utils/api';
import MillisecondsInput from '../common/MillisecondsInput';

const BATCH_POLLING_KEY = 'batch-polling-config';

const DEFAULTS = {
  [BATCH_POLLING_KEY]: {
    pollInterval: 5000,
    minPollInterval: 2000,
    maxPollAttempts: 120,
    maxRetries: 3,
  },
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
  const [issues, setIssues] = useState([]);

  const {
    loading,
    saving,
    values: { [BATCH_POLLING_KEY]: values },
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys: [BATCH_POLLING_KEY],
    defaults: DEFAULTS,
  });

  useForm({ dirty, onSave });

  const onNumberChange = (key) => (e) => {
    const next = toInt(e.target.value, values[key]);
    setValue(BATCH_POLLING_KEY, { ...values, [key]: next });
  };

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
        <MillisecondsInput
          id="poll-interval"
          label="Poll interval (ms)"
          value={values.pollInterval}
          min={1}
          step={100}
          onChange={onNumberChange('pollInterval')}
          helper="How long to wait between each poll attempt."
        />

        <MillisecondsInput
          id="min-poll-interval"
          label="Minimum poll interval (ms)"
          value={values.minPollInterval}
          min={1}
          step={100}
          onChange={onNumberChange('minPollInterval')}
          helper="Lower bound for adaptive backoff—actual interval should never dip below this."
        />

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
