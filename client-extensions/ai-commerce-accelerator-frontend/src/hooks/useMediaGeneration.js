import { useCallback, useState } from 'react';
import notifyUser from '../utils/notifications';
import { toFormData } from '../utils/formData';
import { GENERATE_MEDIA } from '../utils/microservicePaths';

/**
 * Attaches images and PDFs to products that already exist in Liferay.
 *
 * Used for a dataset imported from another instance, which never carries its
 * media, and for a run whose media failed or was skipped. Both leave products
 * without pictures, and both are fixed by the same media-only workflow.
 */
export default function useMediaGeneration({
  api,
  addLog,
  buildPayload,
  dispatch,
  isGenerating,
}) {
  const [isSubmittingMedia, setIsSubmittingMedia] = useState(false);

  const generateMedia = useCallback(
    async ({ sourceSessionId, scope = 'missing' }) => {
      if (isSubmittingMedia) return null;

      if (isGenerating) {
        notifyUser(
          'Please wait for the current workflow to finish before generating media.',
          'warning'
        );
        return null;
      }

      setIsSubmittingMedia(true);

      try {
        const config = buildPayload();

        const payload = {
          ...config,
          sourceSessionId,
          mediaScope: scope,
          // The backend refuses a media run without this. Media is the
          // expensive part of a run, so it never starts implicitly.
          confirmMediaGeneration: true,
        };

        const imageFile =
          config.imageMode === 'custom' ? config.customImageFile : null;
        const pdfFile =
          config.pdfMode === 'custom' ? config.customPDFFile : null;

        addLog(`Requesting media for session ${sourceSessionId}...`, 'info');

        const response =
          imageFile || pdfFile
            ? await api.post(
                GENERATE_MEDIA,
                toFormData(payload, {
                  customImageFile: imageFile,
                  customPDFFile: pdfFile,
                })
              )
            : await api.post(GENERATE_MEDIA, payload);

        if (!response?.sessionId) {
          addLog(
            `Media generation not started: ${response?.error || 'Unknown error'}`,
            'warning'
          );
          notifyUser(
            response?.error || 'Media generation not started',
            'warning'
          );
          return response;
        }

        const totals = {
          images: response.imageCount || 0,
          pdfs: response.pdfCount || 0,
        };

        dispatch({ type: 'RESET_ALL', totals });
        dispatch({
          type: 'SET_ACTIVE_SESSION',
          sessionId: response.sessionId,
          flowType: 'media',
          totals,
        });
        dispatch({ type: 'SET_WORKFLOW_STATUS', status: 'running' });

        addLog(
          `✓ Media workflow submitted for ${totals.images} image(s) and ${totals.pdfs} PDF(s). Session ID: ${response.sessionId}`,
          'success'
        );
        notifyUser('Media generation started');

        return response;
      } catch (error) {
        addLog(`Failed to start media generation: ${error.message}`, 'error');
        notifyUser('Failed to start media generation', 'danger');
        return null;
      } finally {
        setIsSubmittingMedia(false);
      }
    },
    [api, addLog, buildPayload, dispatch, isGenerating, isSubmittingMedia]
  );

  return { generateMedia, isSubmittingMedia };
}
