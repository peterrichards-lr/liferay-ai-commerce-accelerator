import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { getKeyValue, persistConfigKey } from '../../utils/api';
import MillisecondsInput from '../common/MillisecondsInput';

const WS_CONFIG_KEY = 'ws-config';

const DEFAULTS = {
  heartbeatIntervalMs: 30000,
  retryIntervalMs: 500,
  maxRetries: 3,
};

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

export default function WsConfigPanel() {
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
        const raw = await getKeyValue(WS_CONFIG_KEY);
        let parsed = {};
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = {};
        }
        const merged = {
          heartbeatIntervalMs: toInt(
            parsed.heartbeatIntervalMs,
            DEFAULTS.heartbeatIntervalMs
          ),
          retryIntervalMs: toInt(parsed.retryIntervalMs, DEFAULTS.retryIntervalMs),
          maxRetries: toInt(parsed.maxRetries, DEFAULTS.maxRetries),
        };
        if (!alive) return;
        setValues(merged);
        setLastSaved(merged);
      } catch (e) {
        Liferay?.Util?.openToast?.({
          message: 'Failed to load WebSocket configuration.',
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

  // Validation
  useEffect(() => {
    const found = [];
    const { heartbeatIntervalMs, retryIntervalMs, maxRetries } = values;

    if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs < 1000)
      found.push('Heartbeat interval should be at least 1000ms.');
    if (!Number.isFinite(retryIntervalMs) || retryIntervalMs < 100)
      found.push('Retry interval should be at least 100ms.');
    if (!Number.isFinite(maxRetries) || maxRetries < 0)
      found.push('Max retries cannot be negative.');

    if (
      Number.isFinite(heartbeatIntervalMs) &&
      Number.isFinite(retryIntervalMs) &&
      heartbeatIntervalMs < retryIntervalMs
    )
      found.push(
        'Heartbeat interval should typically be greater than retry interval.'
      );

    setIssues(found);
  }, [values]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload = JSON.stringify(values);
      await persistConfigKey(WS_CONFIG_KEY, payload);
      setLastSaved(values);
      Liferay?.Util?.openToast?.({
        message: 'WebSocket configuration saved.',
        type: 'success',
      });
    } catch (e) {
      console.error(e);
      Liferay?.Util?.openToast?.({
        message: 'Failed to save WebSocket configuration.',
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
        <h2 className="sheet-title">WebSocket</h2>
        <div className="sheet-text">
          Stored under <code>{WS_CONFIG_KEY}</code> as JSON:{' '}
          <code>{'{ heartbeatIntervalMs, retryIntervalMs, maxRetries }'}</code>.
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
          helper="Frequency of health checks between client and server."
        />

        <MillisecondsInput
          id="retry-interval"
          label="Retry interval (ms)"
          value={values.retryIntervalMs}
          min={100}
          step={100}
          onChange={onNumberChange('retryIntervalMs')}
          helper="Delay before retrying a failed message delivery."
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
            onChange={onNumberChange('maxRetries')}
          />
          <small className="form-text text-secondary">
            Maximum retry attempts before giving up.
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