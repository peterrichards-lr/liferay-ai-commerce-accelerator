import { useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { getKeyValue, persistConfigKey } from '../../utils/api';

const BATCH_POLLING_KEY = 'batch-polling-config';

const DEFAULTS = {
  pollInterval: 5000,
  minPollInterval: 2000,
  maxPollAttempts: 120,
  maxRetries: 3,
};

export default function BatchPollingConfigPanel() {
  // raw configValue string from Liferay (stringified JSON)
  const [currentKey, setCurrentKey] = useState('');
  const [lastSavedKey, setLastSavedKey] = useState('');

  // parsed form model
  const [model, setModel] = useState(DEFAULTS);

  // issues/disabled
  const [issues, setIssues] = useState([]);
  const disabled = issues.length > 0;

  // load on mount
  useEffect(() => {
    const run = async () => {
      const found = [];
      setIssues(found);
      if (found.length === 0) {
        const key = await getKeyValue(BATCH_POLLING_KEY);
        const str = key || '';
        setCurrentKey(str);
        setLastSavedKey(str);

        // parse or fall back to defaults
        try {
          const parsed = str ? JSON.parse(str) : DEFAULTS;
          setModel((m) => ({ ...m, ...parsed }));
        } catch {
          // if corrupt, show warning but still show defaults in fields
          setModel(DEFAULTS);
          setIssues((prev) => [
            ...prev,
            'Stored value is not valid JSON. Editing and saving will overwrite it.',
          ]);
        }
      }
    };
    run();
  }, []);

  // derived validation
  const validation = useMemo(() => {
    const msgs = [];
    const { pollInterval, minPollInterval, maxPollAttempts, maxRetries } =
      model;

    const ints = [
      'pollInterval',
      'minPollInterval',
      'maxPollAttempts',
      'maxRetries',
    ];
    ints.forEach((k) => {
      const v = model[k];
      if (!Number.isInteger(v) || v < 0)
        msgs.push(`${k} must be a non-negative integer.`);
    });

    if (
      Number.isInteger(model.pollInterval) &&
      Number.isInteger(model.minPollInterval)
    ) {
      if (model.pollInterval < model.minPollInterval) {
        msgs.push('pollInterval should be ≥ minPollInterval.');
      }
    }

    return msgs;
  }, [model]);

  const dirty = currentKey !== lastSavedKey;

  // sync currentKey (string) from model whenever model changes
  useEffect(() => {
    try {
      const str = JSON.stringify({
        pollInterval: toInt(model.pollInterval, DEFAULTS.pollInterval),
        minPollInterval: toInt(model.minPollInterval, DEFAULTS.minPollInterval),
        maxPollAttempts: toInt(model.maxPollAttempts, DEFAULTS.maxPollAttempts),
        maxRetries: toInt(model.maxRetries, DEFAULTS.maxRetries),
      });
      setCurrentKey(str);
    } catch {
      // ignore—validation will block save
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    model.pollInterval,
    model.minPollInterval,
    model.maxPollAttempts,
    model.maxRetries,
  ]);

  const onSave = async () => {
    try {
      await persistConfigKey(BATCH_POLLING_KEY, currentKey);
      setLastSavedKey(currentKey);
      Liferay.Util.openToast({
        message: 'Batch polling config saved.',
        type: 'success',
      });
      // clear any “corrupt JSON” warning once saved
      setIssues((prev) => prev.filter((m) => !m.includes('not valid JSON')));
    } catch (error) {
      if (error?.status && String(error.status) === '400') {
        let response = error.message.replace('HTTP 400 : ', '');
        try {
          response = JSON.parse(response);
        } catch {}
        Liferay.Util.openToast({
          message: response?.title || 'Failed to save batch polling config.',
          type: 'danger',
        });
        return;
      }
      console.error(error);
      Liferay.Util.openToast({
        message: 'Failed to save batch polling config.',
        type: 'danger',
      });
    }
  };

  const onCancel = () => {
    setCurrentKey(lastSavedKey);
    try {
      const parsed = lastSavedKey ? JSON.parse(lastSavedKey) : DEFAULTS;
      setModel({ ...DEFAULTS, ...parsed });
    } catch {
      setModel(DEFAULTS);
    }
  };

  const setNum = (field) => (e) =>
    setModel((m) => ({ ...m, [field]: toInt(e.target.value, m[field]) }));

  return (
    <div className="sheet sheet-lg">
      <div className="sheet-header">
        <h2 className="sheet-title">Batch Polling Configuration</h2>
        <div className="sheet-text">
          Configure polling cadence and retry behavior.
        </div>
      </div>

      <div className="sheet-section">
        <h3
          className="sheet-subtitle"
          style={{
            marginBottom: 0,
            padding: '0.75rem 1.25rem',
            paddingLeft: 0,
          }}
        >
          Polling
        </h3>
        <div className="text-secondary small mb-3">
          Stored under <code>{BATCH_POLLING_KEY}</code> as JSON:
          <code>
            {'{ pollInterval, minPollInterval, maxPollAttempts, maxRetries }'}
          </code>
        </div>

        {!!issues.length && (
          <ClayAlert displayType="warning" title="Warning" className="mb-3">
            {issues.length === 1 ? (
              issues[0]
            ) : (
              <ul className="mb-0">
                {issues.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </ClayAlert>
        )}

        {!!validation.length && (
          <ClayAlert
            displayType="danger"
            title="Please fix the following"
            className="mb-3"
          >
            <ul className="mb-0">
              {validation.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </ClayAlert>
        )}

        <ClayLayout.Row>
          <ClayLayout.Col md={6} xs={12}>
            <ClayForm.Group>
              <label htmlFor="pollInterval">Poll interval (ms)</label>
              <ClayInput
                id="pollInterval"
                type="number"
                min={0}
                step={100}
                value={model.pollInterval}
                onChange={setNum('pollInterval')}
              />
              <small className="form-text text-secondary">
                Delay between polls once a batch is running.
              </small>
            </ClayForm.Group>

            <ClayForm.Group>
              <label htmlFor="minPollInterval">
                Minimum poll interval (ms)
              </label>
              <ClayInput
                id="minPollInterval"
                type="number"
                min={0}
                step={100}
                value={model.minPollInterval}
                onChange={setNum('minPollInterval')}
              />
              <small className="form-text text-secondary">
                Lower bound to prevent aggressive polling.
              </small>
            </ClayForm.Group>
          </ClayLayout.Col>

          <ClayLayout.Col md={6} xs={12}>
            <ClayForm.Group>
              <label htmlFor="maxPollAttempts">Max poll attempts</label>
              <ClayInput
                id="maxPollAttempts"
                type="number"
                min={0}
                step={1}
                value={model.maxPollAttempts}
                onChange={setNum('maxPollAttempts')}
              />
              <small className="form-text text-secondary">
                Stop polling after this many attempts.
              </small>
            </ClayForm.Group>

            <ClayForm.Group>
              <label htmlFor="maxRetries">Max retries</label>
              <ClayInput
                id="maxRetries"
                type="number"
                min={0}
                step={1}
                value={model.maxRetries}
                onChange={setNum('maxRetries')}
              />
              <small className="form-text text-secondary">
                Number of times to retry failed batches.
              </small>
            </ClayForm.Group>
          </ClayLayout.Col>
        </ClayLayout.Row>

        <div className="sheet-footer">
          <div className="btn-group-item">
            <ClayButton
              onClick={onSave}
              className="mr-2"
              disabled={
                disabled || validation.length > 0 || currentKey === lastSavedKey
              }
            >
              <ClayIcon symbol="disk" />
              <span className="ml-2">Save</span>
            </ClayButton>
            <ClayButton
              displayType="secondary"
              onClick={onCancel}
              disabled={disabled || currentKey === lastSavedKey}
            >
              <ClayIcon symbol="restore" />
              <span className="ml-2">Cancel</span>
            </ClayButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function toInt(v, fallback) {
  // accept string or number; coerce to int if finite, else fallback
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}
