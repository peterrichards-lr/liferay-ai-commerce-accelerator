import PropTypes from 'prop-types';
import { useMemo, useState, useRef } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayLabel from '@clayui/label';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import Base64Viewer from './Base64Viewer';
import { isBase64 as isBase64Strict, randomPrefix } from '../../utils/api';

function parseMaybeDataUrl(raw) {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(raw?.trim() || '');
  if (m) return { mime: m[1], b64: m[2] };
  return null;
}

function byteSizeFromBase64(b64) {
  try {
    const len =
      (b64.length * 3) / 4 -
      (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.floor(len));
  } catch {
    return 0;
  }
}

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

export default function PlaceholderItem({
  value,
  onChange,
  fixedMimeType,
  prefix: externalPrefix,
  maxFileSizeBytes = 3 * 1024 * 1024,
}) {
  const [generatedPrefix] = useState(() => externalPrefix || randomPrefix());
  const prefix = externalPrefix || generatedPrefix;

  const { base64Data, mimeType } = value;
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  const normalized = useMemo(() => {
    const parsed = parseMaybeDataUrl(base64Data);
    const effectiveMime = fixedMimeType ?? mimeType;
    if (parsed) {
      return {
        base64: parsed.b64,
        mime: fixedMimeType || effectiveMime || parsed.mime,
        fromDataUrl: true,
        detectedMime: parsed.mime,
      };
    }
    return {
      base64: base64Data,
      mime: effectiveMime,
      fromDataUrl: false,
      detectedMime: null,
    };
  }, [base64Data, mimeType, fixedMimeType]);

  const isValid = useMemo(() => {
    if (!normalized.base64) return false;
    return isBase64Strict(normalized.base64);
  }, [normalized.base64]);

  const src =
    isValid && normalized.mime
      ? `data:${normalized.mime};base64,${normalized.base64}`
      : null;

  const status = !normalized.base64
    ? { type: 'secondary', text: 'Empty' }
    : isValid
    ? { type: 'success', text: 'Ready' }
    : { type: 'warning', text: 'Invalid base64' };

  const approxBytes = normalized.base64
    ? byteSizeFromBase64(normalized.base64)
    : 0;

  const accept =
    fixedMimeType === 'application/pdf'
      ? 'application/pdf'
      : 'image/png,image/jpeg,image/webp';

  const onPickFile = () => fileInputRef.current?.click();

  const onFileChange = (e) => {
    setUploadError('');
    const file = e.target.files?.[0];
    if (!file) return;

    const type = file.type || '';
    if (fixedMimeType === 'application/pdf') {
      if (type !== 'application/pdf') {
        setUploadError('Only PDF files are allowed.');
        e.target.value = '';
        return;
      }
    } else {
      if (!/^image\/(png|jpeg|webp)$/.test(type)) {
        setUploadError('Allowed image types: PNG, JPEG, WEBP.');
        e.target.value = '';
        return;
      }
    }

    if (file.size > maxFileSizeBytes) {
      setUploadError(
        `File is too large (${formatMB(
          file.size
        )} MB). Max allowed is ${formatMB(maxFileSizeBytes)} MB.`
      );
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl.startsWith('data:')) {
        setUploadError('Failed to read file.');
        return;
      }
      if (!fixedMimeType && type && (!mimeType || mimeType === '')) {
        onChange({ base64Data: dataUrl, mimeType: type });
      } else {
        onChange({ base64Data: dataUrl });
      }
      e.target.value = '';
    };
    reader.onerror = () => {
      setUploadError('Failed to read file.');
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  };

  const onClear = () => {
    setUploadError('');
    onChange({ base64Data: '' });
  };

  return (
    <div>
      <div className="d-flex align-items-center mb-2">
        <ClayLabel displayType={status.type}>{status.text}</ClayLabel>
        {approxBytes > 0 && (
          <small className="text-secondary ml-2">
            {(approxBytes / 1024).toFixed(1)} KB
          </small>
        )}
        <div className="ml-auto space-x-2">
          <input
            ref={fileInputRef}
            id={`${prefix}-file`}
            type="file"
            accept={accept}
            style={{ display: 'none' }}
            onChange={onFileChange}
          />
          <ClayButton
            displayType="secondary"
            onClick={onPickFile}
            className="mr-2"
          >
            <ClayIcon symbol="upload" />
            <span className="ml-2">Upload file</span>
          </ClayButton>
          <ClayButton displayType="secondary" onClick={onClear}>
            <ClayIcon symbol="times" />
            <span className="ml-2">Clear</span>
          </ClayButton>
        </div>
      </div>

      <ClayForm.Group className="mb-3">
        <label htmlFor={`${prefix}-b64`} className="font-weight-semi-bold">
          Base64 (or data URL)
        </label>
        <br />
        <textarea
          id={`${prefix}-b64`}
          placeholder="Paste base64… or a full data URL like data:application/pdf;base64,JVBERi0xL…"
          value={base64Data}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = parseMaybeDataUrl(raw);
            if (parsed) {
              if (!fixedMimeType && !mimeType) {
                onChange({ base64Data: raw, mimeType: parsed.mime });
              } else {
                onChange({ base64Data: raw });
              }
            } else {
              onChange({ base64Data: raw });
            }
          }}
          aria-invalid={!!base64Data && !isValid}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="text"
          style={{
            minHeight: 260,
            width: '100%',
            resize: 'vertical',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
        <small className="form-text text-secondary">
          Paste raw base64 or a full data URL. Upload also supported.
        </small>
        {!!base64Data && !isValid && (
          <ClayAlert
            displayType="warning"
            className="mt-2"
            title="Invalid base64"
          >
            Make sure you pasted only the base64 portion (after the comma) or a
            full data URL.
          </ClayAlert>
        )}
        {!!uploadError && (
          <ClayAlert displayType="danger" className="mt-2" title="Upload error">
            {uploadError}
          </ClayAlert>
        )}
      </ClayForm.Group>

      <ClayForm.Group className="mb-3">
        <label htmlFor={`${prefix}-mime`} className="font-weight-semi-bold">
          MIME Type
        </label>
        <ClayInput
          id={`${prefix}-mime`}
          placeholder="e.g. application/pdf, image/png, image/jpeg, image/webp"
          value={fixedMimeType || mimeType || ''}
          onChange={(e) =>
            !fixedMimeType && onChange({ mimeType: e.target.value })
          }
          readOnly={!!fixedMimeType}
          disabled={!!fixedMimeType}
        />
        {fixedMimeType && (
          <small className="form-text text-secondary">
            MIME type is fixed to <code>{fixedMimeType}</code>.
          </small>
        )}
        {!fixedMimeType &&
          normalized.fromDataUrl &&
          normalized.detectedMime && (
            <small className="form-text text-secondary">
              Detected from pasted data URL:{' '}
              <code>{normalized.detectedMime}</code>
            </small>
          )}
      </ClayForm.Group>

      <ClayForm.Group className="mb-0">
        <label className="font-weight-semi-bold" htmlFor={`${prefix}-preview`}>
          Preview
        </label>
        <div
          id={`${prefix}-preview`}
          className="border rounded p-2"
          style={{ minHeight: 220 }}
        >
          {src ? (
            <Base64Viewer
              base64Data={normalized.base64}
              mimeType={normalized.mime}
              width="100%"
              height={
                normalized.mime === 'application/pdf' ? '600px' : undefined
              }
            />
          ) : (
            <div className="text-muted">
              Paste valid base64 (or a full data URL) to preview.
            </div>
          )}
        </div>
      </ClayForm.Group>
    </div>
  );
}

PlaceholderItem.propTypes = {
  value: PropTypes.shape({
    base64Data: PropTypes.string,
    mimeType: PropTypes.string,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  fixedMimeType: PropTypes.string,
  prefix: PropTypes.string,
  maxFileSizeBytes: PropTypes.number,
};
