// OpenAISettingsPanel.jsx (refactored)
import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { getKeyValue, persistConfigKey } from '../../utils/api';

const OPEN_AI_KEY_KEY = 'open-ai-key';

export default function OpenAISettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [keyValue, setKeyValue] = useState('');
  const [lastSaved, setLastSaved] = useState('');
  const [show, setShow] = useState(false);
  const [issues, setIssues] = useState([]);

  const maskedMultiline = useMemo(
    () => (keyValue ? keyValue.replace(/[^\n]/g, '•') : ''),
    [keyValue]
  );

  const copySecret = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(keyValue);
      Liferay?.Util?.openToast?.({
        message: 'Key copied to clipboard.',
        type: 'success',
      });
    } catch {
      Liferay?.Util?.openToast?.({
        message: 'Could not copy key.',
        type: 'danger',
      });
    }
  }, [keyValue]);

  const dirty = keyValue !== lastSaved;

  // -----------------------------
  // Load existing value
  // -----------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const raw = await getKeyValue(OPEN_AI_KEY_KEY);
        const initial = typeof raw === 'string' ? raw : '';
        if (!alive) return;
        setKeyValue(initial);
        setLastSaved(initial);
      } catch (e) {
        Liferay?.Util?.openToast?.({
          message: 'Failed to load OpenAI key.',
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

  // -----------------------------
  // Unsaved-changes guard & shortcut
  // -----------------------------
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

  // -----------------------------
  // Validation
  // -----------------------------
  useEffect(() => {
    const errs = [];
    const v = keyValue.trim();
    if (v.length === 0) {
      errs.push('API key is required.');
    }
    if (/\s/.test(v)) {
      errs.push('Key must not contain spaces or newlines.');
    }
    if (v.length > 0 && v.length < 12) {
      errs.push('Key looks too short. Please check you pasted the full value.');
    }
    setIssues(errs);
  }, [keyValue]);

  const masked = useMemo(
    () => (keyValue ? keyValue.replace(/.(?=.{4})/g, '•') : ''),
    [keyValue]
  );

  // -----------------------------
  // Actions
  // -----------------------------
  const onSave = useCallback(async () => {
    if (saving || issues.length) return;
    setSaving(true);
    try {
      await persistConfigKey(OPEN_AI_KEY_KEY, keyValue.trim());
      setLastSaved(keyValue.trim());
      Liferay?.Util?.openToast?.({
        message: 'OpenAI key saved.',
        type: 'success',
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      Liferay?.Util?.openToast?.({
        message: 'Failed to save OpenAI key.',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }, [saving, keyValue, issues.length]);

  const onCancel = useCallback(() => setKeyValue(lastSaved), [lastSaved]);
  const onClear = useCallback(() => setKeyValue(''), []);

  // -----------------------------
  // Render
  // -----------------------------
  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">OpenAI Settings</h2>
        <div className="sheet-text">
          Stored under <code>{OPEN_AI_KEY_KEY}</code> as plain text. In
          production, prefer using environment variables or a secrets vault
          rather than storing keys in the database.
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
          <label htmlFor="openai-key" className="font-weight-semi-bold">
            OpenAI API Key
          </label>
          <div className="d-flex align-items-start">
            {show ? (
              <ClayInput
                id="openai-key"
                component="textarea" // <-- multiline
                rows={6}
                placeholder="Paste your key…"
                value={keyValue}
                onChange={(e) => setKeyValue(e.target.value)}
                aria-invalid={!!issues.length}
                autoComplete="off"
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              />
            ) : (
              <ClayInput
                id="openai-key-masked"
                component="textarea" // <-- multiline but masked
                rows={6}
                value={maskedMultiline}
                readOnly
                aria-label="Hidden OpenAI key (masked)"
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              />
            )}

            <div className="ml-2 d-flex flex-column">
              <ClayButton
                type="button"
                displayType="secondary"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide key' : 'Show key'}
                title={show ? 'Hide key' : 'Show key'}
                className="mb-2"
              >
                <ClayIcon symbol={show ? 'view' : 'hidden'} />
              </ClayButton>

              <ClayButton
                type="button"
                displayType="secondary"
                onClick={copySecret}
                disabled={!keyValue}
                aria-label="Copy key"
                title="Copy key"
                className="mb-2"
              >
                <ClayIcon symbol="copy" />
              </ClayButton>

              <ClayButton
                type="button"
                displayType="secondary"
                onClick={() => setKeyValue('')}
                aria-label="Clear key"
                title="Clear key"
              >
                <ClayIcon symbol="times" />
              </ClayButton>
            </div>
          </div>
          <small className="form-text text-secondary">
            The value is used by backend services to make requests to the OpenAI
            API.
          </small>
          {keyValue && !show && (
            <div className="text-secondary small mt-1" aria-hidden="true">
              Preview: <code>{masked}</code>
            </div>
          )}
        </ClayForm.Group>
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={!dirty || saving || issues.length > 0}
            aria-disabled={!dirty || saving || issues.length > 0}
            aria-label={saving ? 'Saving OpenAI key…' : 'Save OpenAI key'}
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
