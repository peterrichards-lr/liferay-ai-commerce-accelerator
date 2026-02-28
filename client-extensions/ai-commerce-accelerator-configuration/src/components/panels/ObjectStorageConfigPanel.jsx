import { useEffect, useState, useMemo } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useForm, useObjectStorage } from '../../hooks';
import MillisecondsInput from '../common/MillisecondsInput';

const OBJ_KEY = 'object-storage-config';

const DEFAULTS = {
  [OBJ_KEY]: {
    signedUrlTtlSec: 900,
    uploadPrefix: 'uploads',
    sidecarEndpoint: 'http://127.0.0.1:1106',
  },
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
  const [issues, setIssues] = useState([]);

  const {
    loading,
    saving,
    values: { [OBJ_KEY]: values },
    dirty,
    onSave,
    onCancel,
    setValue,
  } = useObjectStorage({
    keys: [OBJ_KEY],
    defaults: DEFAULTS,
  });

  useForm({ dirty, onSave });

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

  const onTextChange = (key) => (e) => {
    const next = e.target.value;
    setValue(OBJ_KEY, { ...values, [key]: next });
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
        <MillisecondsInput
          id="signed-ttl"
          label="Signed URL TTL (ms)"
          value={values.signedUrlTtlSec * 1000}
          min={60000}
          step={1000}
          onChange={(e) => {
            const ms = toInt(e.target.value, values.signedUrlTtlSec * 1000);
            const sec = Math.floor(ms / 1000);
            setValues((v) => ({ ...v, signedUrlTtlSec: Math.max(60, sec) }));
          }}
          helper="Time-to-live for generated signed URLs."
        />

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
