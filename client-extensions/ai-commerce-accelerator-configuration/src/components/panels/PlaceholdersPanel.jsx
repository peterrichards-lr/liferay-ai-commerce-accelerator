import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ClayPanel from '@clayui/panel';
import ClayAlert from '@clayui/alert';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import PlaceholderItem from '../common/PlaceholderItem';
import {
  getKeyValue,
  persistConfigKey,
  parsePlaceholderValue,
  normalizeToJsonPayload,
} from '../../utils/api';
import { useApi } from '../../hooks/useMicroserviceApi';
import { useObjectStorage } from '../../hooks/useObjectStorage';
import {
  MEDIA_PLACEHOLDERS,
  MEDIA_PLACEHOLDER_BASE64,
} from '../../utils/microservicePaths';

const PDF_PLACEHOLDER_KEY = 'default-pdf';
const IMAGE_PLACEHOLDER_KEY = 'default-image';

const MICROSERVICE_CONFIG_KEY = 'microservice-config';
const DEFAULTS = {
  [MICROSERVICE_CONFIG_KEY]: {
    url: 'http://localhost:3001',
  },
};

export default function PlaceholdersPanel(props) {
  const { microserviceUrl: injectedMsUrl } = props;

  const {
    loading: loadingConfig,
    values: { [MICROSERVICE_CONFIG_KEY]: msConfig },
  } = useObjectStorage({
    keys: [MICROSERVICE_CONFIG_KEY],
    defaults: {
      [MICROSERVICE_CONFIG_KEY]: {
        url: injectedMsUrl || DEFAULTS[MICROSERVICE_CONFIG_KEY].url,
      },
    },
  });

  const effectiveMsUrl = useMemo(() => {
    const url =
      injectedMsUrl || msConfig?.url || DEFAULTS[MICROSERVICE_CONFIG_KEY].url;
    return url?.replace(/\/$/, '');
  }, [injectedMsUrl, msConfig?.url]);

  const api = useApi(effectiveMsUrl);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState(null);

  const [pdfBase64, setPdfBase64] = useState('');
  const [pdfMime, setPdfMime] = useState('application/pdf');
  const [lastPdfBase64, setLastPdfBase64] = useState('');
  const [lastPdfMime, setLastPdfMime] = useState('application/pdf');
  const [pdfIssues, setPdfIssues] = useState([]);

  const [imgBase64, setImgBase64] = useState('');
  const [imgMime, setImgMime] = useState('image/png');
  const [lastImgBase64, setLastImgBase64] = useState('');
  const [lastImgMime, setLastImgMime] = useState('image/png');
  const [imgIssues, setImgIssues] = useState([]);

  const [availablePlaceholders, setAvailablePlaceholders] = useState([]);
  const [selectedFilename, setSelectedFilename] = useState(null);

  const abortRef = useRef(null);

  const hasIssues = pdfIssues.length > 0 || imgIssues.length > 0;

  const dirty = useMemo(
    () =>
      pdfBase64 !== lastPdfBase64 ||
      pdfMime !== lastPdfMime ||
      imgBase64 !== lastImgBase64 ||
      imgMime !== lastImgMime,
    [
      pdfBase64,
      lastPdfBase64,
      pdfMime,
      lastPdfMime,
      imgBase64,
      lastImgBase64,
      imgMime,
      lastImgMime,
    ]
  );

  const fetchGallery = useCallback(async () => {
    if (!effectiveMsUrl) return;
    try {
      setGalleryLoading(true);
      setGalleryError(null);
      const res = await api.get(MEDIA_PLACEHOLDERS);
      if (res?.success) {
        setAvailablePlaceholders(res.placeholders || []);
      } else {
        setGalleryError(res?.error || 'Failed to fetch gallery');
      }
    } catch (err) {
      console.error('Failed to fetch gallery', err);
      setGalleryError(err.message);
    } finally {
      setGalleryLoading(false);
    }
  }, [api, effectiveMsUrl]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const pdfPayload = normalizeToJsonPayload(
        pdfBase64,
        'application/pdf',
        'application/pdf'
      );
      const imgPayload = normalizeToJsonPayload(
        imgBase64,
        'image/png',
        imgMime
      );

      await Promise.all([
        persistConfigKey(PDF_PLACEHOLDER_KEY, JSON.stringify(pdfPayload)),
        persistConfigKey(IMAGE_PLACEHOLDER_KEY, JSON.stringify(imgPayload)),
      ]);

      setLastPdfBase64(pdfPayload.base64);
      setLastPdfMime(pdfPayload.mimeType);
      setLastImgBase64(imgPayload.base64);
      setLastImgMime(imgPayload.mimeType);

      Liferay?.Util?.openToast?.({
        message: 'Placeholders saved successfully.',
        type: 'success',
      });
    } catch (error) {
      console.error(error);
      Liferay?.Util?.openToast?.({
        message: 'Failed to save placeholders.',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }, [saving, pdfBase64, imgBase64, imgMime]);

  const onCancel = useCallback(() => {
    setPdfBase64(lastPdfBase64);
    setPdfMime(lastPdfMime);
    setImgBase64(lastImgBase64);
    setImgMime(lastImgMime);
  }, [lastPdfBase64, lastPdfMime, lastImgBase64, lastImgMime]);

  const onSelectFromGallery = useCallback(
    async (placeholder) => {
      try {
        setGalleryLoading(true);
        const path = MEDIA_PLACEHOLDER_BASE64.replace(
          ':filename',
          placeholder.filename
        );
        const res = await api.get(path);
        if (res?.success) {
          setImgBase64(res.base64);
          setImgMime(res.mimeType || placeholder.mimeType);
          setSelectedFilename(placeholder.filename);
        }
      } catch (err) {
        console.error('Failed to select from gallery', err);
      } finally {
        setGalleryLoading(false);
      }
    },
    [api]
  );

  const onAddToGallery = useCallback(async () => {
    if (!imgBase64 || imgIssues.length > 0) return;
    const label = prompt('Enter a label for this placeholder:', 'Custom');
    if (!label) return;

    try {
      setGalleryLoading(true);
      const res = await api.post(MEDIA_PLACEHOLDERS, {
        label,
        mimeType: imgMime,
        base64: imgBase64,
      });

      if (res?.success) {
        Liferay?.Util?.openToast?.({
          message: 'Image added to gallery.',
          type: 'success',
        });
        fetchGallery();
      }
    } catch (err) {
      console.error('Failed to add to gallery', err);
      Liferay?.Util?.openToast?.({
        message: 'Failed to add image to gallery.',
        type: 'danger',
      });
    } finally {
      setGalleryLoading(false);
    }
  }, [api, imgBase64, imgIssues, imgMime, fetchGallery]);

  const onDeleteFromGallery = useCallback(
    async (filename) => {
      if (!confirm('Are you sure you want to delete this placeholder?')) return;
      try {
        setGalleryLoading(true);
        const res = await api.del(`${MEDIA_PLACEHOLDERS}/${filename}`);
        if (res?.success) {
          fetchGallery();
        }
      } catch (err) {
        console.error('Failed to delete placeholder', err);
      } finally {
        setGalleryLoading(false);
      }
    },
    [api, fetchGallery]
  );

  const validateBase64 = useCallback((s) => {
    if (!s) return ['No data provided'];

    if (!/^[data]?.*[base64,]?[A-Za-z0-9+/=\n\r]+$/.test(s))
      return ['Invalid Base64 characters detected'];
    return [];
  }, []);

  useEffect(() => {
    setPdfIssues(validateBase64(pdfBase64));
  }, [pdfBase64, validateBase64]);

  useEffect(() => {
    setImgIssues(validateBase64(imgBase64));
  }, [imgBase64, validateBase64]);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      if (loadingConfig) return;
      setLoading(true);
      try {
        const [rawPdf, rawImg] = await Promise.all([
          getKeyValue(PDF_PLACEHOLDER_KEY),
          getKeyValue(IMAGE_PLACEHOLDER_KEY),
        ]);

        try {
          const { base64 } = parsePlaceholderValue(
            rawPdf || '',
            'application/pdf'
          );
          setPdfBase64(base64);
          setPdfMime('application/pdf');
          setLastPdfBase64(base64);
          setLastPdfMime('application/pdf');
        } catch {
          setPdfIssues(['Failed to load PDF placeholder']);
        }

        try {
          const { base64, mimeType } = parsePlaceholderValue(
            rawImg || '',
            'image/png'
          );
          setImgBase64(base64);
          setImgMime(mimeType || 'image/png');
          setLastImgBase64(base64);
          setLastImgMime(mimeType || 'image/png');
        } catch {
          setImgIssues(['Failed to load image placeholder']);
        }

        fetchGallery();
      } catch {
        Liferay?.Util?.openToast?.({
          message: 'Failed to load placeholders.',
          type: 'danger',
        });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [fetchGallery, loadingConfig]);

  useEffect(() => {
    const handler = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    const handler = (e) => {
      const key = e.key?.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 's') {
        e.preventDefault();
        onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSave]);

  const renderIssues = (issues) =>
    issues?.length ? (
      <ul className="alert alert-warning p-2 mt-2" role="alert">
        {issues.map((msg, i) => (
          <li key={i}>{msg}</li>
        ))}
      </ul>
    ) : null;

  if (loadingConfig) {
    return <div className="p-5 text-center">Loading configuration...</div>;
  }

  return (
    <div
      className="sheet sheet-lg"
      aria-busy={loading || saving}
      aria-live="polite"
    >
      <div className="sheet-header">
        <h2 className="sheet-title">Placeholders</h2>
        <div className="sheet-text">
          <p>
            PDF placeholder (MIME fixed) and Image placeholder (MIME editable &
            persisted). Estimated sizes are shown below.
          </p>
          <p>
            For larger files, it may be best to upload them as custom files in
            the data generator. In the case of images, there is an option to try
            and reduce the file size.
          </p>
        </div>
      </div>

      <div className="sheet-section">
        <div className="alert alert-info mb-4">
          <div className="d-flex align-items-center mb-2">
            <ClayIcon symbol="info-circle" className="mr-2" />
            <span className="font-weight-bold">Workflow Tip:</span>
          </div>
          <ul className="mb-0 small">
            <li>
              <strong>Upload file:</strong> Local staging. Loads an image into
              memory for immediate use. Only saved to Liferay when you click{' '}
              <strong>Save</strong>.
            </li>
            <li>
              <strong>Add to Gallery:</strong> Server persistence. Saves the
              currently selected image permanently to the microservice storage
              for reuse across sessions.
            </li>
          </ul>
        </div>

        <ClayPanel
          header="PDF Placeholder"
          displayType="unstyled"
          className="mb-4"
        >
          <div className="text-secondary small mb-3">
            Stored under <code>{PDF_PLACEHOLDER_KEY}</code> as JSON:{' '}
            <code>{'{ mimeType, base64 }'}</code> with{' '}
            <code>mimeType=&quot;application/pdf&quot;</code>.
          </div>
          <PlaceholderItem
            prefix="pdf"
            value={{ base64Data: pdfBase64, mimeType: pdfMime }}
            onChange={(patch) => {
              if (patch.base64Data !== undefined)
                setPdfBase64(patch.base64Data);
              if (patch.mimeType !== undefined) setPdfMime('application/pdf');
            }}
            fixedMimeType="application/pdf"
          />
          {renderIssues(pdfIssues)}
        </ClayPanel>

        <ClayPanel header="Image Placeholder" displayType="unstyled">
          <div className="text-secondary small mb-3">
            Stored under <code>{IMAGE_PLACEHOLDER_KEY}</code> as JSON:{' '}
            <code>{'{ mimeType, base64 }'}</code> with an editable{' '}
            <code>mimeType</code> (e.g. <code>image/png</code>,{' '}
            <code>image/jpeg</code>, <code>image/webp</code>).
          </div>

          <div className="mb-4 border rounded p-3 bg-light">
            <div className="d-flex align-items-center justify-content-between mb-3">
              <span className="h4 mb-0">Gallery Options</span>
              <ClayButton
                displayType="secondary"
                size="sm"
                onClick={fetchGallery}
                disabled={galleryLoading}
                title="Reload gallery"
              >
                <ClayIcon
                  symbol="reload"
                  className={galleryLoading ? 'ani-spin' : ''}
                />
              </ClayButton>
            </div>

            {galleryError && (
              <ClayAlert displayType="danger" className="mb-3">
                {galleryError}
              </ClayAlert>
            )}

            <div className="d-flex flex-wrap" style={{ gap: '1rem' }}>
              {availablePlaceholders.map((data) => {
                const fullUrl = `${effectiveMsUrl}${data.url}`;
                const isSelected = selectedFilename === data.filename;

                return (
                  <div
                    key={data.filename}
                    className={`p-2 border rounded text-center position-relative transition-all shadow-sm ${
                      isSelected
                        ? 'border-primary bg-white'
                        : 'border-light bg-white'
                    }`}
                    style={{
                      width: '120px',
                      cursor: 'pointer',
                      boxShadow: isSelected
                        ? '0 0 0 2px var(--primary)'
                        : 'none',
                    }}
                    onClick={() => onSelectFromGallery(data)}
                  >
                    <div
                      className="mb-2 d-flex align-items-center justify-content-center bg-light rounded overflow-hidden"
                      style={{ height: '80px' }}
                    >
                      <img
                        src={fullUrl}
                        alt={data.label}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '100%',
                          objectFit: 'contain',
                        }}
                        onError={(e) => {
                          e.target.src =
                            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiIHJ5PSIyIj48L3JlY3Q+PGNpcmNsZSBjeD0iOC41IiBjeT0iOC41IiByPSIxLjUiPjwvY2lyY2xlPjxwYXRoIGQ9Ik0yMSAxNWwtNS01TDUgMjEiPjwvcGF0aD48L3N2Zz4=';
                        }}
                      />
                    </div>
                    <div className="small font-weight-semi-bold text-truncate px-1">
                      {data.label}
                    </div>

                    {![
                      'liferay_product_default.webp',
                      'blank.webp',
                      'no_image_available.webp',
                    ].includes(data.filename) && (
                      <button
                        type="button"
                        className="btn btn-unstyled position-absolute"
                        style={{ top: '2px', right: '2px', padding: '2px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteFromGallery(data.filename);
                        }}
                        title="Remove from gallery"
                      >
                        <ClayIcon
                          symbol="times-circle-full"
                          className="text-danger"
                        />
                      </button>
                    )}
                  </div>
                );
              })}
              {!galleryLoading && availablePlaceholders.length === 0 && (
                <div className="text-muted small p-3 w-100 text-center border border-dashed rounded">
                  No images in gallery. Use &quot;Add to Gallery&quot; to
                  populate.
                </div>
              )}
              {galleryLoading && (
                <div className="w-100 text-center p-3">
                  <span className="spinner-border spinner-border-sm text-primary" />
                </div>
              )}
            </div>
          </div>

          <div className="d-flex align-items-center justify-content-between mb-2">
            <span className="form-label font-weight-semi-bold mb-0">
              Active Selection
            </span>
            <ClayButton
              displayType="secondary"
              size="sm"
              disabled={!imgBase64 || imgIssues.length > 0 || galleryLoading}
              onClick={onAddToGallery}
            >
              <ClayIcon symbol="plus" className="mr-1" />
              Add to Gallery
            </ClayButton>
          </div>

          <PlaceholderItem
            prefix="img"
            value={{ base64Data: imgBase64, mimeType: imgMime }}
            onChange={(patch) => {
              if (patch.base64Data !== undefined)
                setImgBase64(patch.base64Data);
              if (patch.mimeType !== undefined) setImgMime(patch.mimeType);
            }}
          />
          {renderIssues(imgIssues)}
        </ClayPanel>
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={hasIssues || !dirty || saving}
            aria-disabled={hasIssues || !dirty || saving}
            aria-label={
              saving ? 'Saving placeholders…' : 'Save placeholders to Liferay'
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
    </div>
  );
}
