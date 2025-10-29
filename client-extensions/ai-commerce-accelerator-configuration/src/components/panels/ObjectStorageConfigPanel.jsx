import { useCallback, useEffect, useMemo, useState } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { getKeyValue, persistConfigKey } from '../../utils/api';

const OBJ_KEY = 'object-storage-config';

const DEFAULTS = {
  signedUrlTtlSec: 900,
  uploadPrefix: 'uploads',
  sidecarEndpoint: 'http://127.0.0.1:1106',
};

function toInt(v, fallback) {
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : fallback;
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:'; 
  } catch {
    return false;
  }
}

export default function ObjectStorageConfigPanel() {
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
        const raw = await getKeyValue(OBJ_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const merged = {
          signedUrlTtlSec: toInt(parsed.signedUrlTtlSec, DEFAULTS.signedUrlTtlSec),
          uploadPrefix: parsed.uploadPrefix || DEFAULTS.uploadPrefix,
          sidecarEndpoint: parsed.sidecarEndpoint || DEFAULTS.sidecarEndpoint,
        };
        if (!alive) return;
        setValues(merged);
        setLastSaved(merged);
      } catch {
        Liferay?.Util?.openToast?.({
          message: 'Failed to load Object Storage configuration.',
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

  useEffect(() => {
    const found = [];
    if (!Number.isFinite(values.signedUrlTtlSec) || values.signedUrlTtlSec < 60)
      found.push('Signed URL TTL must be ≥ 60 seconds.');
    if (!values.uploadPrefix?.trim())
      found.push('Upload prefix cannot be empty.');
    if (!isHttpUrl(values.sidecarEndpoint))
      found.push('Sidecar endpoint must be a valid http/https URL.');
    setIssues(found);
  }, [values]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await persistConfigKey(OBJ_KEY, JSON.stringify(values));
      setLastSaved(values);
      Liferay?.Util?.openToast?.({
        message: 'Object Storage configuration saved.',
        type: 'success',
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      Liferay?.Util?.openToast?.({
        message: 'Failed to save Object Storage configuration.',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }, [saving, values]);

  const onCancel = useCallback(() => setValues(lastSaved), [lastSaved]);

  const onNumberChange = (key, min) => (e) => {
    const next = toInt(e.target.value, values[key]);
    setValues((v) => ({ ...v, [key]: Math.max(min ?? -Infinity, next) }));
  };

  const onTextChange = (key) => (e) => {
    const next = e.target.value;
    setValues((v) => ({ ...v, [key]: next }));
  };

  return (
    <ClayLayout.Sheet aria-busy={loading || saving} aria-live="polite">
      <div className="sheet-header">
        <h2 className="sheet-title">Object Storage</h2>
        <div className="sheet-text">
          Stored under <code>{OBJ_KEY}</code>.
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
        <ClayForm.Group>
          <label htmlFor="signed-ttl" className="font-weight-semi-bold">
            Signed URL TTL (seconds)
          </label>
          <ClayInput
            id="signed-ttl"
            type="number"
            min={60}
            step={30}
            value={values.signedUrlTtlSec}
            onChange={onNumberChange('signedUrlTtlSec', 60)}
          />
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="upload-prefix" className="font-weight-semi-bold">
            Upload prefix
          </label>
          <ClayInput
            id="upload-prefix"
            type="text"
            value={values.uploadPrefix}
            onChange={onTextChange('uploadPrefix')}
          />
          <small className="form-text text-secondary">
            Subdirectory used when generating upload paths.
          </small>
        </ClayForm.Group>

        <ClayForm.Group>
          <label htmlFor="sidecar-endpoint" className="font-weight-semi-bold">
            Sidecar endpoint
          </label>
          <ClayInput
            id="sidecar-endpoint"
            type="url"
            value={values.sidecarEndpoint}
            onChange={onTextChange('sidecarEndpoint')}
          />
          <small className="form-text text-secondary">
            HTTP(S) endpoint used to obtain credentials and sign URLs.
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
            aria-label="Save Object Storage configuration"
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />
            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>

          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={!dirty || saving}
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