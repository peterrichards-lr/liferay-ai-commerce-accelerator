import PropTypes from 'prop-types';
import { useMemo, useState, useEffect } from 'react';
import ClayAlert from '@clayui/alert';
import ClayIcon from '@clayui/icon';

const cleanB64 = (s = '') => s.replace(/\s+/g, '');
const byteSizeFromBase64 = (b64 = '') => {
  const c = cleanB64(b64);
  const len =
    (c.length * 3) / 4 - (c.endsWith('==') ? 2 : c.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor(len));
};

function b64ToBlob(b64, mimeType) {
  const binary = atob(cleanB64(b64));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

export default function Base64Viewer({
  base64Data,
  mimeType,
  width = '100%',
  height = '600px',
  alt = 'Embedded content',
  showMeta = true,
  allowDownload = true,
  preferredPdf = 'iframe',
}) {
  const valid = Boolean(base64Data && mimeType);
  const dataUrl = useMemo(
    () => (valid ? `data:${mimeType};base64,${cleanB64(base64Data)}` : ''),
    [valid, mimeType, base64Data]
  );
  const estBytes = useMemo(
    () => (valid ? byteSizeFromBase64(base64Data) : 0),
    [valid, base64Data]
  );

  const isImage = mimeType?.startsWith('image/');
  const isPdf = mimeType === 'application/pdf';

  const [downloadHref, setDownloadHref] = useState('');
  useEffect(() => {
    if (!allowDownload || !valid) return;
    const blob = b64ToBlob(base64Data, mimeType);
    const url = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDownloadHref(url);
    return () => URL.revokeObjectURL(url);
  }, [allowDownload, valid, base64Data, mimeType]);

  if (!valid) {
    return <p className="text-secondary">No content available.</p>;
  }

  return (
    <div className="base64-viewer">
      {showMeta && (
        <div className="d-flex align-items-center mb-2 text-secondary small">
          <span>{mimeType}</span>
          {estBytes > 0 && (
            <span className="ml-2">• {(estBytes / 1024).toFixed(1)} KB</span>
          )}
          {allowDownload && downloadHref && (
            <a
              href={downloadHref}
              download={`download.${mimeType.split('/')[1] || 'bin'}`}
              className="ml-auto d-inline-flex align-items-center"
            >
              <ClayIcon symbol="download" />
              <span className="ml-1">Download</span>
            </a>
          )}
        </div>
      )}

      {isImage && (
        <img
          src={dataUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          style={{ maxWidth: width, height: 'auto' }}
        />
      )}

      {isPdf && preferredPdf === 'iframe' && (
        <iframe
          src={dataUrl}
          title={alt}
          width={width}
          height={height}
          style={{ border: 0 }}
          aria-label="PDF preview"
        />
      )}

      {isPdf && preferredPdf === 'embed' && (
        <embed
          src={dataUrl}
          type="application/pdf"
          width={width}
          height={height}
        />
      )}

      {isPdf && preferredPdf === 'object' && (
        <object
          data={dataUrl}
          type="application/pdf"
          width={width}
          height={height}
          aria-label="PDF preview"
        >
          <p>
            PDF preview not available.{' '}
            {allowDownload && downloadHref ? (
              <a href={downloadHref}>Download instead</a>
            ) : null}
          </p>
        </object>
      )}

      {!isImage && !isPdf && (
        <ClayAlert displayType="info" title="Unsupported">
          Unsupported MIME type for inline preview: <code>{mimeType}</code>.
          {allowDownload && downloadHref ? (
            <>
              {' '}
              You can still <a href={downloadHref}>download the file</a>.
            </>
          ) : null}
        </ClayAlert>
      )}
    </div>
  );
}

Base64Viewer.propTypes = {
  base64Data: PropTypes.string.isRequired,
  mimeType: PropTypes.string.isRequired,
  width: PropTypes.string,
  height: PropTypes.string,
  alt: PropTypes.string,
  showMeta: PropTypes.bool,
  allowDownload: PropTypes.bool,
  preferredPdf: PropTypes.oneOf(['iframe', 'embed', 'object']),
};
