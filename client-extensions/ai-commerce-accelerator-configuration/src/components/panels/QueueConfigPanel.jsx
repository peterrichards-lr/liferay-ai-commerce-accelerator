import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { getKeyValue, persistConfigKey } from '../../utils/api';

const QUEUE_KEY = 'queue-config';

const DEFAULTS = {
  defaults: {
    concurrency: 2,
    maxRetries: 3,
    retryDelay: 5000,
    jobTimeout: 300000,
    cleanupInterval: 300000,
    jobTTL: 3600000,
  },
  queues: [],
};

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

export default function QueueConfigPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState([]);
  const [values, setValues] = useState(DEFAULTS);
  const [lastSaved, setLastSaved] = useState(DEFAULTS);
  const [selectedQueue, setSelectedQueue] = useState(null);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(lastSaved),
    [values, lastSaved]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const raw = await getKeyValue(QUEUE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const merged = {
          defaults: { ...DEFAULTS.defaults, ...parsed.defaults },
          queues: parsed.queues || [],
        };
        if (!alive) return;
        setValues(merged);
        setLastSaved(merged);
      } catch {
        Liferay?.Util?.openToast?.({
          message: 'Failed to load queue configuration.',
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
    const found = [];
    const { defaults } = values;
    if (!Number.isFinite(defaults.concurrency) || defaults.concurrency < 1)
      found.push('Default concurrency must be ≥ 1.');
    if (!Number.isFinite(defaults.maxRetries) || defaults.maxRetries < 0)
      found.push('Default max retries cannot be negative.');
    if (!Number.isFinite(defaults.retryDelay) || defaults.retryDelay < 0)
      found.push('Default retry delay must be positive.');
    setIssues(found);
  }, [values]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await persistConfigKey(QUEUE_KEY, JSON.stringify(values));
      setLastSaved(values);
      Liferay?.Util?.openToast?.({
        message: 'Queue configuration saved.',
        type: 'success',
      });
    } catch {
      Liferay?.Util?.openToast?.({
        message: 'Failed to save queue configuration.',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }, [saving, values]);

  const onCancel = useCallback(() => setValues(lastSaved), [lastSaved]);

  const updateDefault = (key) => (e) =>
    setValues((v) => ({
      ...v,
      defaults: { ...v.defaults, [key]: toInt(e.target.value, v.defaults[key]) },
    }));

  const addQueue = () => {
    const name = prompt('Enter new queue name:');
    if (!name || values.queues.find((q) => q.name === name)) return;
    const newQueue = {
      name,
      concurrency: values.defaults.concurrency,
      maxRetries: values.defaults.maxRetries,
      retryDelay: values.defaults.retryDelay,
      jobTimeout: values.defaults.jobTimeout,
      jobTTL: values.defaults.jobTTL,
    };
    setValues((v) => ({ ...v, queues: [...v.queues, newQueue] }));
  };

  const updateQueue = (index, key, val) =>
    setValues((v) => {
      const qs = [...v.queues];
      qs[index] = { ...qs[index], [key]: val };
      return { ...v, queues: qs };
    });

  const deleteQueue = (index) => {
    if (!confirm('Delete this queue?')) return;
    setValues((v) => {
      const qs = [...v.queues];
      qs.splice(index, 1);
      return { ...v, queues: qs };
    });
  };

  const renderQueueFields = (q, i) => (
    <div
      key={q.name}
      className="border rounded p-3 mb-3 bg-light"
      aria-label={`Queue: ${q.name}`}
    >
      <div className="d-flex justify-content-between align-items-center mb-2">
        <strong>{q.name}</strong>
        <ClayButton
          displayType="unstyled"
          size="sm"
          className="text-danger"
          onClick={() => deleteQueue(i)}
          aria-label={`Delete ${q.name}`}
        >
          <ClayIcon symbol="trash" />
        </ClayButton>
      </div>
      {['concurrency', 'maxRetries', 'retryDelay', 'jobTimeout', 'jobTTL'].map(
        (field) => (
          <ClayForm.Group key={field}>
            <label htmlFor={`${q.name}-${field}`} className="font-weight-semi-bold">
              {field}
            </label>
            <ClayInput
              id={`${q.name}-${field}`}
              type="number"
              value={q[field]}
              onChange={(e) =>
                updateQueue(i, field, toInt(e.target.value, q[field]))
              }
            />
          </ClayForm.Group>
        )
      )}
    </div>
  );

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">Queue Configuration</h2>
        <div className="sheet-text">
          Stored under <code>{QUEUE_KEY}</code>.
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
        <h4>Default Settings</h4>
        {Object.entries(values.defaults).map(([k, v]) => (
          <ClayForm.Group key={k}>
            <label htmlFor={k} className="font-weight-semi-bold">
              {k}
            </label>
            <ClayInput
              id={k}
              type="number"
              value={v}
              onChange={updateDefault(k)}
            />
          </ClayForm.Group>
        ))}

        <h4 className="mt-4">Queues</h4>
        {values.queues.map(renderQueueFields)}
        <ClayButton
          displayType="secondary"
          size="sm"
          onClick={addQueue}
          aria-label="Add queue"
        >
          <ClayIcon symbol="plus" />
          <span className="ml-2">Add Queue</span>
        </ClayButton>
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={!dirty || saving || issues.length > 0}
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />
            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>
          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
          >
            <ClayIcon symbol="restore" />
            <span className="ml-2">Cancel</span>
          </ClayButton>
        </div>
      </div>
    </ClayLayout.Sheet>
  );
}