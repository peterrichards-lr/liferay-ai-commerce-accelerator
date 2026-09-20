import { useEffect, useState } from 'react';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';
import MillisecondsInput from '../common/MillisecondsInput';

const WS_CONFIG_KEY = 'ws-config';

// `retryIntervalMs` and `maxRetries` used to be offered here. Nothing read
// them, and the behaviour they described did not exist: there is no message
// delivery retry, and the dashboard reconnects with exponential backoff from
// 1s to a 10s ceiling without ever giving up. They were removed rather than
// wired to a mechanism that would have had to be invented. See #1064.
const DEFAULTS = {
  [WS_CONFIG_KEY]: {
    heartbeatIntervalMs: 30000,
  },
};

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

export default function WsConfigPanel() {
  const [issues, setIssues] = useState([]);

  const {
    loading,
    saving,
    values: { [WS_CONFIG_KEY]: values },
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys: [WS_CONFIG_KEY],
    defaults: DEFAULTS,
  });

  useForm({ dirty, onSave });

  useEffect(() => {
    const found = [];
    const { heartbeatIntervalMs } = values;

    // The server applies the same floor, falling back to 30000 below it.
    if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs < 1000)
      found.push('Heartbeat interval should be at least 1000ms.');

    setIssues(found);
  }, [values]);

  const onNumberChange = (key) => (e) => {
    const next = toInt(e.target.value, values[key]);
    setValue(WS_CONFIG_KEY, { ...values, [key]: next });
  };

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">WebSocket</h2>
        <div className="sheet-text">
          Stored under <code>{WS_CONFIG_KEY}</code> as JSON:{' '}
          <code>{'{ heartbeatIntervalMs }'}</code>. Applied by the microservice
          when it starts accepting connections.
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
          id="heartbeat-interval"
          label="Heartbeat interval (ms)"
          value={values.heartbeatIntervalMs}
          min={1000}
          step={500}
          onChange={onNumberChange('heartbeatIntervalMs')}
          helper="How often the server pings each connected client, terminating any that has not answered since the previous ping."
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
              saving
                ? 'Saving WebSocket configuration…'
                : 'Save WebSocket configuration'
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
