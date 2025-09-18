import { useEffect, useMemo, useState } from 'react';
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

  const disabledAny = pdfIssues.length > 0 || imgIssues.length > 0;

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

  useEffect(() => {
    const run = async () => {
      try {
        const rawPdf = await getKeyValue(PDF_PLACEHOLDER_KEY);
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
        const rawImg = await getKeyValue(IMAGE_PLACEHOLDER_KEY);
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
    };
    run();
  }, []);

  const onSave = async () => {
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

      await persistConfigKey(PDF_PLACEHOLDER_KEY, JSON.stringify(pdfPayload));
      await persistConfigKey(IMAGE_PLACEHOLDER_KEY, JSON.stringify(imgPayload));

      setLastPdfBase64(pdfPayload.base64);
      setLastPdfMime(pdfPayload.mimeType);
      setLastImgBase64(imgPayload.base64);
      setLastImgMime(imgPayload.mimeType);

      Liferay.Util.openToast({
        message: 'Placeholders saved successfully.',
        type: 'success',
      });
    } catch (error) {
      console.error(error);
      Liferay.Util.openToast({
        message: 'Failed to save placeholders.',
        type: 'danger',
      });
    }
  };

  const onCancel = () => {
    setPdfBase64(lastPdfBase64);
    setPdfMime(lastPdfMime);
    setImgBase64(lastImgBase64);
    setImgMime(lastImgMime);
  };

  return (
    <div className="sheet sheet-lg">
      <div className="sheet-header">
        <h2 className="sheet-title">Placeholders</h2>
        <div className="sheet-text">
          PDF placeholder (MIME fixed) and Image placeholder (MIME editable &
          persisted).
        </div>
      </div>

      <div className="sheet-section">
        <ClayPanel displayTitle="PDF Placeholder" displayType="unstyled">
          <div className="text-secondary small mb-3">
            Stored under <code>{PDF_PLACEHOLDER_KEY}</code> as JSON:{' '}
            <code>{'{ mimeType, base64 }'}</code> with
            <code> mimeType="application/pdf"</code>.
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
        </ClayPanel>
      </div>

      <div className="sheet-footer">
        <div className="btn-group-item">
          <ClayButton
            onClick={onSave}
            className="mr-2"
            disabled={disabledAny || !dirty}
          >
            <ClayIcon symbol="disk" />
            <span className="ml-2">Save</span>
          </ClayButton>
          <ClayButton
            displayType="secondary"
            onClick={onCancel}
            disabled={disabledAny || !dirty}
          >
            <ClayIcon symbol="restore" />
            <span className="ml-2">Cancel</span>
          </ClayButton>
        </div>
      </div>
    </div>
  );
}
