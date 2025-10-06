import React from 'react';
import ClayPanel from '@clayui/panel';
import ClayForm, { ClayInput, ClaySelect } from '@clayui/form';
import { useApp } from '../../context/AppContext';
import { ConfirmProvider, useConfirm } from '../ConfirmProvider';

export default function AdvancedPanel({
  disabled = false,
  connected = false,
  generationConfig,
  onClearCommerceData,
}) {
  const { config, setConfig } = useApp();

  function ClearCommerceDataButton({ disabled = false }) {
    const confirm = useConfirm();

    const onClick = async () => {
      const ok = await confirm({
        title: 'Clear Commerce Data',
        message:
          'This cannot be undone. All selected Commerce Data will be removed.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        destructive: true,
      });
      if (ok) {
        onClearCommerceData &&
          typeof onClearCommerceData === 'function' &&
          (await onClearCommerceData());
      }
    };
    return (
      <button
        type="button"
        className={`btn w-100 btn-danger my-2 py-2`}
        onClick={onClick}
        disabled={disabled}
      >
        <i className={`icon icon-warning`}></i>
        Clear Commerce Data
      </button>
    );
  }

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

        <ClayForm.Group>
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

        <div className="divider"></div>

        <ClayForm.Group>
          <ConfirmProvider>
            <ClearCommerceDataButton disabled={!connected} />
          </ConfirmProvider>
          <div className="form-text">
            Proceeding will delete the Commerce data in your Liferay DXP
            instance.
          </div>
        </ClayForm.Group>
      </ClayPanel.Body>
    </ClayPanel>
  );
}
