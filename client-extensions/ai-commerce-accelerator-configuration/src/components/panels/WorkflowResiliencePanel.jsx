import { useEffect, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';
import MillisecondsInput from '../common/MillisecondsInput';

const RESILIENCE_KEY = 'workflow-resilience-config';

const DEFAULTS = {
  [RESILIENCE_KEY]: {
    initialDelayMs: 5000,
    maxRetries: 5,
    multiplier: 2,
    deletionConcurrency: 5,
  },
};

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

export default function WorkflowResiliencePanel() {
  const [issues, setIssues] = useState([]);

  const {
    loading,
    saving,
    values: { [RESILIENCE_KEY]: values },
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys: [RESILIENCE_KEY],
    defaults: DEFAULTS,
  });

  useForm({ dirty, onSave });

  const onNumberChange = (key) => (e) => {
    const next = toInt(e.target.value, values[key]);
    setValue(RESILIENCE_KEY, { ...values, [key]: next });
  };

  // Validation
  useEffect(() => {
    const found = [];
    const { initialDelayMs, maxRetries, multiplier, deletionConcurrency } =
      values;

    if (!Number.isFinite(initialDelayMs) || initialDelayMs < 0)
      found.push('Initial delay must be a non-negative number (ms).');
    if (!Number.isFinite(maxRetries) || maxRetries < 1)
      found.push('Max retries must be at least 1.');
    if (!Number.isFinite(multiplier) || multiplier < 1)
      found.push('Backoff multiplier must be at least 1.');
    if (!Number.isFinite(deletionConcurrency) || deletionConcurrency < 1)
      found.push('Deletion concurrency must be at least 1.');

    setIssues(found);
  }, [values]);

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">Workflow Resilience</h2>
        <div className="sheet-text">
          Tune the exponential backoff parameters for synchronization delays
          (e.g., waiting for Liferay search indexing). Stored under{' '}
          <code>{RESILIENCE_KEY}</code>.
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
          id="initial-delay"
          label="Initial Delay (ms)"
          value={values.initialDelayMs}
          min={0}
          step={500}
          onChange={onNumberChange('initialDelayMs')}
          helper="Base delay for the first retry attempt."
        />

        <ClayForm.Group>
          <label htmlFor="max-retries" className="font-weight-semi-bold">
            Maximum Retries
          </label>
          <ClayInput
            id="max-retries"
            type="number"
            min={1}
            step={1}
            value={values.maxRetries}
            onChange={onNumberChange('maxRetries')}
          />
          <small className="form-text text-secondary">
            How many times to poll for Liferay readiness before proceeding.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="multiplier" className="font-weight-semi-bold">
            Backoff Multiplier
          </label>
          <ClayInput
            id="multiplier"
            type="number"
            min={1}
            step={0.5}
            value={values.multiplier}
            onChange={onNumberChange('multiplier')}
          />
          <small className="form-text text-secondary">
            Factor by which the delay increases after each failed attempt (e.g.,
            2 = double the wait).
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label
            htmlFor="deletion-concurrency"
            className="font-weight-semi-bold"
          >
            Deletion Concurrency
          </label>
          <ClayInput
            id="deletion-concurrency"
            type="number"
            min={1}
            max={50}
            step={1}
            value={values.deletionConcurrency || 5}
            onChange={onNumberChange('deletionConcurrency')}
          />
          <small className="form-text text-secondary">
            Maximum number of concurrent requests to clear option/spec
            associations on product deletion.
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
