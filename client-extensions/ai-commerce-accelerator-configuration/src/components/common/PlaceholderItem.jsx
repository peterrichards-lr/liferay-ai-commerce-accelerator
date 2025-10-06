import PropTypes from 'prop-types';
import { useMemo, useRef, useState, useCallback } from 'react';
import ClayForm, { ClayInput } from '@clayui/form';
import ClayAlert from '@clayui/alert';
import ClayLabel from '@clayui/label';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import Base64Viewer from './Base64Viewer';
import { isBase64 as isBase64Strict, randomPrefix } from '../../utils/api';

const BASE64_CHAR_LIMIT = 65000;
const MAX_BYTES_FROM_CHAR_LIMIT = 3 * Math.floor(BASE64_CHAR_LIMIT / 4);

function getBase64Payload(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const m = /^data:[^;]+;base64,(.+)$/i.exec(s);
  return (m ? m[1] : s).replace(/\s+/g, '');
}

function parseMaybeDataUrl(raw) {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(raw?.trim() || '');
  if (m) return { mime: m[1], b64: m[2] };
  return null;
}

function countBase64Chars(raw) {
  const parsed = parseMaybeDataUrl(raw);
  const b64 = parsed ? parsed.b64 : raw || '';
  return b64.replace(/\s+/g, '').length;
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

function toMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

// Basic signature sniffing for common types (PNG, JPEG, PDF, WEBP)
function detectMimeFromBase64(b64) {
  try {
    const head = atob(b64.slice(0, 64));
    const bytes = Array.from(head, (c) => c.charCodeAt(0));
    const startsWith = (...sig) => sig.every((v, i) => bytes[i] === v);
    // '%PDF' -> 0x25 0x50 0x44 0x46
    if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
    // PNG -> 89 50 4E 47 0D 0A 1A 0A
    if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
      return 'image/png';
    // JPEG -> FF D8 FF
    if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
    // WEBP (RIFF....WEBP)
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    )
      return 'image/webp';
  } catch {}
  return null;
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

async function resizeBase64ToFitLimit(
  dataUrl,
  {
    targetCharLimit = BASE64_CHAR_LIMIT,
    preferType, // e.g., 'image/jpeg', 'image/webp'
  } = {}
) {
  const payload = getBase64Payload(dataUrl);
  if (!payload) return dataUrl;

  // Fast path: already fits.
  if (payload.length <= targetCharLimit) return dataUrl;

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Failed to decode image'));
    i.src = dataUrl;
  });

  // Decide output type (favor jpeg for best size; keep webp if source is webp)
  const isWebp = /^data:image\/webp/i.test(dataUrl);
  const targetType = isWebp ? 'image/webp' : preferType || 'image/jpeg';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  // Initial scale guess based on area ~ proportional to Base64 length
  const currentLen = payload.length;
  let scale = Math.sqrt(targetCharLimit / currentLen);
  scale = Math.min(1, Math.max(0.05, scale));

  const drawScaled = (s) => {
    const w = Math.max(1, Math.floor(img.width * s));
    const h = Math.max(1, Math.floor(img.height * s));
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
  };

  // Try a few passes: reduce scale and/or quality until we fit
  let quality = 0.92;
  let result = dataUrl;
  for (let pass = 0; pass < 8; pass = 1) {
    drawScaled(scale);
    result = canvas.toDataURL(targetType, quality);
    const len = getBase64Payload(result).length;
    if (len <= targetCharLimit) return result;
    // tighten: alternate reducing scale and quality
    if (pass % 2 === 0) {
      scale *= 0.85; // shrink geometry
      scale = Math.max(0.05, scale);
    } else {
      quality *= 0.85; // lower compression quality
      quality = Math.max(0.2, quality);
    }
  }
  // Return the smallest we managed (even if still too big)
  return result;
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
  const [oversizeDataUrl, setOversizeDataUrl] = useState(null);
  const [oversizeType, setOversizeType] = useState('');
  const [isResizing, setIsResizing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // live base64 char count (ignores data URL header and whitespace)
  const base64CharCount = useMemo(
    () => countBase64Chars(base64Data || ''),
    [base64Data]
  );

  const remainingChars = useMemo(
    () => BASE64_CHAR_LIMIT - base64CharCount,
    [base64CharCount]
  );

  // Normalize incoming value (raw base64 or data URL)
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
    // allow whitespace in textarea input (strip before validation)
    const trimmed = normalized.base64.replace(/\s+/g, '');
    return isBase64Strict(trimmed);
  }, [normalized.base64]);

  const approxBytes = normalized.base64
    ? byteSizeFromBase64(normalized.base64.replace(/\s+/g, ''))
    : 0;

  const src = useMemo(() => {
    if (!isValid || !normalized.mime) return null;
    return `data:${normalized.mime};base64,${normalized.base64.replace(
      /\s+/g,
      ''
    )}`;
  }, [isValid, normalized.mime, normalized.base64]);

  const status = !normalized.base64
    ? { type: 'secondary', text: 'Empty' }
    : isValid
    ? { type: 'success', text: 'Ready' }
    : { type: 'warning', text: 'Invalid base64' };

  const accept =
    fixedMimeType === 'application/pdf'
      ? 'application/pdf'
      : 'image/png,image/jpeg,image/webp';

  const onPickFile = useCallback(() => fileInputRef.current?.click(), []);

  const ingestDataUrl = useCallback(
    (dataUrl, overrideMime) => {
      if (!dataUrl?.startsWith('data:')) {
        setUploadError('Failed to read file.');
        return;
      }
      if (!fixedMimeType && overrideMime && (!mimeType || mimeType === '')) {
        onChange({ base64Data: dataUrl, mimeType: overrideMime });
      } else {
        onChange({ base64Data: dataUrl });
      }
    },
    [fixedMimeType, mimeType, onChange]
  );

  const validateSelectedFile = useCallback(
    (file) => {
      const type = file.type || '';
      if (fixedMimeType === 'application/pdf') {
        if (type !== 'application/pdf') return 'Only PDF files are allowed.';
      } else if (!/^image\/(png|jpeg|webp)$/.test(type)) {
        return 'Allowed image types: PNG, JPEG, WEBP.';
      }
      const hardLimit = Math.min(maxFileSizeBytes, MAX_BYTES_FROM_CHAR_LIMIT);
      if (file.size > hardLimit) {
        return {
          code: 'too_large_for_base64',
          message: `File is too large (${toMB(
            file.size
          )} MB). Max allowed for this field is ${toMB(
            hardLimit
          )} MB to keep the Base64 under ${BASE64_CHAR_LIMIT.toLocaleString()} characters.`,
        };
      }
      return null;
    },
    [fixedMimeType, maxFileSizeBytes]
  );

  const onFileChange = useCallback(
    async (e) => {
      setUploadError('');
      setOversizeType('');
      setOversizeDataUrl(null);
      const file = e.target.files?.[0];
      if (!file) return;
      const err = validateSelectedFile(file);
      if (err) {
        if (
          typeof err === 'object' &&
          err.code === 'too_large_for_base64' &&
          /^image\//.test(file.type)
        ) {
          try {
            const dataUrl = await fileToDataURL(file);
            setOversizeDataUrl(dataUrl);
            setOversizeType(file.type);
            setUploadError(err.message);
          } catch {
            setUploadError('Failed to read file.');
          } finally {
            e.target.value = '';
          }
          return;
        }
        setUploadError(
          typeof err === 'string' ? err : err.message || 'Upload error.'
        );
        e.target.value = '';
        return;
      }
      try {
        const dataUrl = await fileToDataURL(file);
        ingestDataUrl(dataUrl, file.type);
      } catch (ex) {
        setUploadError('Failed to read file.');
      } finally {
        e.target.value = '';
      }
    },
    [validateSelectedFile, ingestDataUrl]
  );

  const onClear = useCallback(() => {
    setUploadError('');
    setOversizeDataUrl(null);
    setOversizeType('');
    onChange({ base64Data: '' });
  }, [onChange]);

  const onTextChange = useCallback(
    (raw) => {
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
    },
    [fixedMimeType, mimeType, onChange]
  );

  // drag & drop support
  const onDrop = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      setUploadError('');
      setOversizeDataUrl(null);
      setOversizeType('');
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const err = validateSelectedFile(file);
      if (err) {
        if (
          typeof err === 'object' &&
          err.code === 'too_large_for_base64' &&
          /^image\//.test(file.type)
        ) {
          try {
            const dataUrl = await fileToDataURL(file);
            setOversizeDataUrl(dataUrl);
            setOversizeType(file.type);
            setUploadError(err.message);
          } catch {
            setUploadError('Failed to read file.');
          }
          return;
        }
        setUploadError(
          typeof err === 'string' ? err : err.message || 'Upload error.'
        );
        return;
      }
      try {
        const dataUrl = await fileToDataURL(file);
        ingestDataUrl(dataUrl, file.type);
      } catch {
        setUploadError('Failed to read file.');
      }
    },
    [validateSelectedFile, ingestDataUrl]
  );

  const onPaste = useCallback(
    async (e) => {
      // Support pasting an image/PDF file directly from clipboard
      const item = Array.from(e.clipboardData?.items || []).find(
        (it) => it.kind === 'file'
      );
      if (item) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const err = validateSelectedFile(file);
          if (err) {
            if (
              typeof err === 'object' &&
              err.code === 'too_large_for_base64' &&
              /^image\//.test(file.type)
            ) {
              try {
                const dataUrl = await fileToDataURL(file);
                setOversizeDataUrl(dataUrl);
                setOversizeType(file.type);
                setUploadError(err.message);
              } catch {
                setUploadError('Failed to read file.');
              }
              return;
            }
            setUploadError(
              typeof err === 'string' ? err : err.message || 'Upload error.'
            );
            return;
          }
          try {
            const dataUrl = await fileToDataURL(file);
            ingestDataUrl(dataUrl, file.type);
          } catch {
            setUploadError('Failed to read file.');
          }
        }
      }
    },
    [validateSelectedFile, ingestDataUrl]
  );

  const handleResizeToFit = useCallback(async () => {
    if (!oversizeDataUrl) return;
    try {
      setIsResizing(true);
      const resized = await resizeBase64ToFitLimit(oversizeDataUrl, {
        targetCharLimit: BASE64_CHAR_LIMIT,
        preferType: /^image\/webp/i.test(oversizeType)
          ? 'image/webp'
          : 'image/jpeg',
      });
      const len = getBase64Payload(resized).length;
      if (len > BASE64_CHAR_LIMIT) {
        setUploadError(
          `Tried to reduce the image but it still exceeds ${BASE64_CHAR_LIMIT.toLocaleString()} Base64 characters.`
        );
        return;
      }
      ingestDataUrl(resized, oversizeType);
      setOversizeDataUrl(null);
      setOversizeType('');
      setUploadError('');
    } catch {
      setUploadError('Failed to resize the image.');
    } finally {
      setIsResizing(false);
    }
  }, [oversizeDataUrl, oversizeType, ingestDataUrl]);

  // If user pasted raw base64 without MIME, we can show a hint based on signature
  const sniffedMime = useMemo(() => {
    if (!normalized.mime && isValid && normalized.base64) {
      return detectMimeFromBase64(normalized.base64.replace(/\s+/g, ''));
    }
    return null;
  }, [normalized.mime, isValid, normalized.base64]);

  return (
    <div role="group" aria-labelledby={`${prefix}-heading`}>
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
            type="button"
            displayType="secondary"
            onClick={onPickFile}
            className="mr-2"
          >
            <ClayIcon symbol="upload" />
            <span className="ml-2">Upload file</span>
          </ClayButton>
          <ClayButton type="button" displayType="secondary" onClick={onClear}>
            <ClayIcon symbol="times" />
            <span className="ml-2">Clear</span>
          </ClayButton>
        </div>
      </div>

      <ClayForm.Group className="mb-3">
        <label
          id={`${prefix}-heading`}
          htmlFor={`${prefix}-b64`}
          className="font-weight-semi-bold"
        >
          Base64 (or data URL)
        </label>
        <br />
        <textarea
          id={`${prefix}-b64`}
          placeholder="Paste base64… or a full data URL like data:application/pdf;base64,JVBERi0xL…"
          value={base64Data}
          onChange={(e) => onTextChange(e.target.value)}
          onPaste={onPaste}
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
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={dragOver ? 'border-primary' : ''}
        />
        <div className="d-flex mt-1">
          <small
            id={`${prefix}-b64-counter`}
            className={remainingChars < 0 ? 'text-danger' : 'text-secondary'}
          >
            {remainingChars.toLocaleString()} /{' '}
            {BASE64_CHAR_LIMIT.toLocaleString()} characters left
          </small>
        </div>

        <small className="form-text text-secondary">
          Paste raw base64 or a full data URL. You can also drag & drop a file
          or paste directly from the clipboard.
        </small>
        {!!sniffedMime && !fixedMimeType && !mimeType && (
          <small className="form-text text-secondary">
            Detected type from bytes: <code>{sniffedMime}</code>
          </small>
        )}
        {!!base64Data && !isValid && (
          <ClayAlert
            displayType="warning"
            className="mt-2"
            title="Invalid base64"
            role="alert"
            aria-live="assertive"
          >
            Make sure you pasted only the base64 portion (after the comma) or a
            full data URL.
          </ClayAlert>
        )}
        {!!uploadError && (
          <ClayAlert
            displayType="danger"
            className="mt-2"
            title="Upload error"
            role="alert"
            aria-live="assertive"
          >
            <div className="d-flex align-items-center">
              <span>{uploadError}</span>
              {!!oversizeDataUrl && (
                <ClayButton
                  small
                  displayType="secondary"
                  className="ml-3"
                  onClick={handleResizeToFit}
                  disabled={isResizing}
                >
                  {isResizing ? 'Resizing…' : 'Reduce image to fit'}
                </ClayButton>
              )}
            </div>
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

      <ClayForm.Group >
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
              base64Data={normalized.base64.replace(/\s+/g, '')}
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
