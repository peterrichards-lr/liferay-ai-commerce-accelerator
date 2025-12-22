import { useState, useCallback } from 'react';
import { toFormData } from '../utils/formData';
import { computeTotalsFromConfig } from '../state/progressSelectors';
import { GENERATE_WORKFLOW } from '../utils/microservicePaths';

export default function useGeneration({
  addLog,
  buildPayload,
  api,
  config,
  dispatch,
  forceDemoMode,
  generationConfig,
  mountedRef,
  progress,
  setProgress,
  setGenerationCompleted,
  connectionEstablished,
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  const generateData = useCallback(async () => {
    if (!connectionEstablished) {
      addLog(
        'Please test the connection first before generating data.',
        'error'
      );
      return;
    }

    if (mountedRef.current) {
      setIsGenerating(true);
      setGenerationCompleted(false);
    }

    const { products, accounts, orders, images, pdfs } =
      computeTotalsFromConfig(generationConfig);

    dispatch({
      type: 'SET_TOTALS',
      totals: { products, accounts, orders, images, pdfs },
    });

    dispatch({
      type: 'SET_EXPECTED_VALUES',
      values: { images, pdfs },
    });

    dispatch({
      type: 'MERGE',
      payload: {
        products: { ...progress.products, completed: 0, errors: [] },
        accounts: { ...progress.accounts, completed: 0, errors: [] },
        orders: { ...progress.orders, completed: 0, errors: [] },
        images: { ...progress.images, completed: 0, errors: [] },
        pdfs: { ...progress.pdfs, completed: 0, errors: [] },
      },
    });

    addLog(
      `Submitting generation workflow: ${generationConfig.productCount} products, ${generationConfig.accountCount} accounts, ${generationConfig.orderCount} orders`,
      'info'
    );

    try {
      const payload = {
        ...buildPayload(),
        ...generationConfig,
      };

      if (forceDemoMode) {
        payload.demoMode = true;
        if (payload.imageMode === 'generate') payload.imageMode = 'default';
        if (payload.pdfMode === 'generate') payload.pdfMode = 'default';
      }

      const imageFile =
        generationConfig.imageMode === 'custom'
          ? generationConfig.customImageFile
          : null;
      const pdfFile =
        generationConfig.pdfMode === 'custom'
          ? generationConfig.customPDFFile
          : null;

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
        addLog(
          `✓ Workflow submitted successfully. Session ID: ${response.sessionId}`,
          'success'
        );
      } else {
        addLog(
          `✗ Workflow submission failed: ${response.error || 'Unknown error'}`,
          'error'
        );
      }
    } catch (error) {
      addLog(
        `✗ Workflow submission failed: ${
          error.response?.data?.error || error.message
        }`,
        'error'
      );
    } finally {
      if (mountedRef.current) {
        setIsGenerating(false);
        setGenerationCompleted(true);
      }
    }
  }, [
    addLog,
    api,
    buildPayload,
    config,
    connectionEstablished,
    dispatch,
    forceDemoMode,
    generationConfig,
    mountedRef,
    progress,
    setProgress,
    setGenerationCompleted,
  ]);

  return { isGenerating, generateData };
}
