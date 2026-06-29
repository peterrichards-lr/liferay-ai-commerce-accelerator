import { useState, useCallback } from 'react';
import { toFormData } from '../utils/formData';
import { computeTotalsFromConfig } from '../state/progressSelectors';
import { GENERATE_WORKFLOW } from '../utils/microservicePaths';

export default function useGeneration({
  addLog,
  buildPayload,
  api,
  dispatch,
  forceDemoMode,
  generationConfig,
  mountedRef,
  progress,
  connectionEstablished,
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const generateData = useCallback(
    async (finalConfig) => {
      const activeConfig = finalConfig || generationConfig;

      if (!connectionEstablished) {
        addLog(
          'Please test the connection first before generating data.',
          'error'
        );
        return;
      }

      if (mountedRef.current) {
        setIsSubmitting(true);
      }

      const { products, accounts, orders, images, pdfs, warehouses } =
        computeTotalsFromConfig(activeConfig);

      const totals = { products, accounts, orders, images, pdfs, warehouses };

      dispatch({
        type: 'RESET_ALL',
        totals,
      });

      dispatch({
        type: 'SET_EXPECTED_VALUES',
        values: { images, pdfs },
      });

      if (activeConfig.seedPack) {
        addLog(`Submitting seed pack: ${activeConfig.seedPack}`, 'info');
      } else {
        addLog(
          `Submitting generation workflow: ${activeConfig.productCount} products, ${activeConfig.accountCount} accounts, ${activeConfig.orderCount} orders`,
          'info'
        );
      }

      try {
        const payload = {
          ...buildPayload(),
          ...activeConfig,
        };

        if (forceDemoMode) {
          payload.demoMode = true;
          if (payload.imageMode === 'ai' || payload.imageMode === 'generate')
            payload.imageMode = 'default';
          if (payload.pdfMode === 'ai' || payload.pdfMode === 'generate')
            payload.pdfMode = 'default';
        }

        const imageFile =
          activeConfig.imageMode === 'custom'
            ? activeConfig.customImageFile
            : null;
        const pdfFile =
          activeConfig.pdfMode === 'custom' ? activeConfig.customPDFFile : null;

        let response;
        if (imageFile || pdfFile) {
          const form = toFormData(payload, {
            customImageFile: imageFile,
            customPDFFile: pdfFile,
          });
          response = await api.post(GENERATE_WORKFLOW, form);
        } else {
          response = await api.post(GENERATE_WORKFLOW, payload);
        }

        if (response.sessionId) {
          dispatch({
            type: 'SET_ACTIVE_SESSION',
            sessionId: response.sessionId,
            flowType: 'generate',
            totals: { products, accounts, orders, images, pdfs, warehouses },
          });
          dispatch({
            type: 'SET_WORKFLOW_STATUS',
            status: 'running',
          });
          addLog(
            `✓ Workflow submitted successfully. Session ID: ${response.sessionId}`,
            'success'
          );
        } else {
          dispatch({
            type: 'SET_WORKFLOW_STATUS',
            status: 'failed',
          });
          addLog(
            `✗ Workflow submission failed: ${response.error || 'Unknown error'}`,
            'error'
          );
        }
      } catch (error) {
        dispatch({
          type: 'SET_WORKFLOW_STATUS',
          status: 'failed',
        });
        addLog(
          `✗ Workflow submission failed: ${
            error.response?.data?.error || error.message
          }`,
          'error'
        );
      } finally {
        if (mountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [
      addLog,
      api,
      buildPayload,
      connectionEstablished,
      dispatch,
      forceDemoMode,
      generationConfig,
      mountedRef,
    ]
  );

  const cancelWorkflow = useCallback(async () => {
    if (!progress.activeSessionId) return;

    try {
      addLog('Cancellation requested...', 'warning');
      const res = await api.get(
        `/workflows/sessions/${progress.activeSessionId}/cancel`
      );

      if (res?.success) {
        addLog('✓ Workflow cancellation confirmed by server.', 'success');
      } else {
        addLog(
          'Failed to cancel workflow: ' + (res?.error || 'Unknown error'),
          'error'
        );
      }
    } catch (error) {
      console.error('Failed to cancel workflow:', error);
      addLog('Error cancelling workflow: ' + error.message, 'error');
    }
  }, [api, addLog, progress.activeSessionId]);

  return { isSubmitting, generateData, cancelWorkflow };
}
