import React from 'react';
import ClayForm, { ClaySelect } from '@clayui/form';
import { useApp } from '../../context/AppContext';
import { ConfirmProvider, useConfirm } from '../ConfirmProvider';
import CollapsiblePanel from '../ui/CollapsiblePanel';

function ClearCommerceDataButton({
  disabled = false,
  onDeleteAllCommerceData,
}) {
  const confirm = useConfirm();

  const onClick = async () => {
    const ok = await confirm({
      title: 'Delete All Commerce Data',
      message:
        'This will delete ALL commerce data across ALL channels and catalogs: orders, accounts, products, price lists, promotions, specifications, options and option categories. It is not limited to data this app created - anything of those types found in the instance is removed, including entries added by hand. Channels, catalogs, and the base price list and base promotion that Liferay creates with each catalog are kept. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    });
    if (ok) {
      onDeleteAllCommerceData &&
        typeof onDeleteAllCommerceData === 'function' &&
        (await onDeleteAllCommerceData());
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
      Delete All Commerce Data
    </button>
  );
}

function ClearChannelCommerceDataButton({
  disabled = false,
  onDeleteSelectedCommerceData,
}) {
  const confirm = useConfirm();

  const onClick = async () => {
    const ok = await confirm({
      title: 'Delete Selected Commerce Data',
      message:
        'This will delete the data this app created for the selected channel and catalog: orders, accounts, products, price lists, promotions, specifications and options. Data this app did not create is left in place. This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    });
    if (ok) {
      onDeleteSelectedCommerceData &&
        typeof onDeleteSelectedCommerceData === 'function' &&
        (await onDeleteSelectedCommerceData());
    }
  };
  return (
    <button
      type="button"
      className={`btn w-100 btn-secondary my-2 py-2`}
      onClick={onClick}
      disabled={disabled}
    >
      <i className={`icon icon-warning`}></i>
      Delete Selected Commerce Data
    </button>
  );
}

function FactoryResetButton() {
  const confirm = useConfirm();

  const onClick = async () => {
    const ok = await confirm({
      title: 'Factory Reset App',
      message:
        'Are you sure you want to perform a factory reset? This will delete all saved configurations, keys, and workflow history from your browser. This action cannot be undone.',
      confirmText: 'Reset',
      cancelText: 'Cancel',
      destructive: true,
    });
    if (ok) {
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('aica_')) {
          localStorage.removeItem(key);
        }
      });
      window.location.reload();
    }
  };

  return (
    <button
      type="button"
      className="btn w-100 btn-outline-danger my-2 py-2"
      onClick={onClick}
    >
      <i className="icon icon-warning-full mr-2"></i>
      Factory Reset App
    </button>
  );
}

export default function AdvancedPanel({
  disabled = false,
  connected = false,
  onDeleteAllCommerceData,
  onDeleteSelectedCommerceData,
  batchSizes,
}) {
  const { config, setConfig } = useApp();

  return (
    <CollapsiblePanel
      id="advanced-options"
      title="Advanced Options"
      startOpen={false}
      collapsedIndicator="⏵"
      expandedIndicator="⏷"
    >
      {' '}
      <ClayForm.Group className="mb-3">
        <label htmlFor="batchSize" className="form-label">
          Batch Size
        </label>
        <ClaySelect
          id="batchSize"
          aria-label="Batch Size"
          value={config.batchSize}
          onChange={(e) => setConfig({ batchSize: Number(e.target.value) })}
          disabled={disabled}
        >
          {batchSizes.map((size) => (
            <ClaySelect.Option
              key={size}
              value={size}
              label={size.toString()}
            />
          ))}
        </ClaySelect>
        <div className="form-text">How many items per batch.</div>
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
          <ClearChannelCommerceDataButton
            disabled={!connected || !config.channelId}
            onDeleteSelectedCommerceData={onDeleteSelectedCommerceData}
          />
          <ClearCommerceDataButton
            onDeleteAllCommerceData={onDeleteAllCommerceData}
          />
          <div className="divider my-3"></div>
          <FactoryResetButton />
        </ConfirmProvider>
        <div className="form-text">
          Proceeding will delete data or configurations from your Liferay DXP
          instance or local browser.
        </div>
      </ClayForm.Group>
    </CollapsiblePanel>
  );
}
