import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ClayPanel from '@clayui/panel';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import PlaceholderItem from '../common/PlaceholderItem';
import {
  getKeyValue,
  persistConfigKey,
  parsePlaceholderValue,
  normalizeToJsonPayload,
} from '../../utils/api';

const PDF_PLACEHOLDER_KEY = 'default-pdf';
const IMAGE_PLACEHOLDER_KEY = 'default-image';

export default function PlaceholdersPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
        } catch (e) {
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
        } catch (e) {
          setImgIssues(['Failed to load image placeholder']);
        }
      } catch (e) {
        Liferay?.Util?.openToast?.({
          message: 'Failed to load placeholders.',
          type: 'danger',
        });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

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
        <ClayPanel displayTitle="PDF Placeholder" displayType="unstyled">
          <div className="text-secondary small mb-3">
            Stored under <code>{PDF_PLACEHOLDER_KEY}</code> as JSON:{' '}
            <code>{'{ mimeType, base64 }'}</code> with{' '}
            <code>mimeType="application/pdf"</code>.
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

        <ClayPanel displayTitle="Image Placeholder" displayType="unstyled">
          <div className="text-secondary small mb-3">
            Stored under <code>{IMAGE_PLACEHOLDER_KEY}</code> as JSON:{' '}
            <code>{'{ mimeType, base64 }'}</code> with an editable{' '}
            <code>mimeType</code> (e.g. <code>image/png</code>,{' '}
            <code>image/jpeg</code>, <code>image/webp</code>).
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
            aria-label={saving ? 'Saving placeholders…' : 'Save placeholders'}
          >
            <ClayIcon symbol={saving ? 'time' : 'disk'} />
            <span className="ml-2">{saving ? 'Saving…' : 'Save'}</span>
          </ClayButton>
          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={hasIssues || !dirty || saving}
            aria-disabled={hasIssues || !dirty || saving}
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
