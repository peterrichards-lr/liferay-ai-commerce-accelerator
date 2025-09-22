import React from 'react';
import ClayPanel from '@clayui/panel';
import ClayForm, { ClayInput, ClaySelect } from '@clayui/form';
import { useApp } from '../../context/AppContext';

export default function AdvancedPanel({ disabled = false, generationConfig }) {
  const { config, setConfig } = useApp();

  // Optional: prefill from generationConfig when present
  React.useEffect(() => {
    if (!generationConfig) return;
    // Example only; uncomment/adjust if you want to prefill:
    // if (generationConfig.defaultBatch && !config.batchSize) {
    //   setConfig({ batchSize: generationConfig.defaultBatch });
    // }
  }, [generationConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ClayPanel
      collapsable
      displayTitle="Advanced"
      displayType="secondary"
      showCollapseIcon
    >
      <ClayPanel.Body>
        <ClayForm.Group className="mb-3">
          <label htmlFor="batchSize" className="form-label">
            Batch Size
          </label>
          <ClayInput
            id="batchSize"
            type="number"
            min={1}
            value={config.batchSize}
            onChange={(e) =>
              setConfig({ batchSize: Math.max(1, Number(e.target.value) || 1) })
            }
            disabled={disabled}
          />
          <div className="form-text">How many items per batch.</div>
        </ClayForm.Group>

        <ClayForm.Group className="mb-3">
          <label htmlFor="aiModel" className="form-label">
            AI Model
          </label>
          <ClaySelect
            id="aiModel"
            aria-label="AI Model"
            value={config.aiModel}
            onChange={(e) => setConfig({ aiModel: e.target.value })}
            disabled={disabled}
          >
            <ClaySelect.Option value="gpt-4o-mini" label="GPT-4o-Mini" />
            <ClaySelect.Option value="gpt-4o" label="GPT-4o" />
            <ClaySelect.Option value="gpt-4.1-mini" label="GPT-4.1-Mini" />
          </ClaySelect>
          <div className="form-text">Choose based on speed/cost needs.</div>
        </ClayForm.Group>

        <ClayForm.Group className="mb-0">
          <label htmlFor="wsLoggingLevel" className="form-label">
            WebSocket Logging
          </label>
          <ClaySelect
            id="wsLoggingLevel"
            aria-label="WebSocket Logging"
            value={config.wsLoggingLevel ?? 'off'}
            onChange={(e) => setConfig({ wsLoggingLevel: e.target.value })}
            disabled={disabled}
          >
            <ClaySelect.Option value="off" label="Off" />
            <ClaySelect.Option value="info" label="Info" />
            <ClaySelect.Option value="debug" label="Debug" />
          </ClaySelect>
          <div className="form-text">Enable only for troubleshooting.</div>
        </ClayForm.Group>
      </ClayPanel.Body>
    </ClayPanel>
  );
}
