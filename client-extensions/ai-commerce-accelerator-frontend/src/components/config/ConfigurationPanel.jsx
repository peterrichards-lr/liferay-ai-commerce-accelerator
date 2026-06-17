// src/components/config/ApplicationConfigPanel.jsx
import React from 'react';
import ConnectionAuthCard from './ConnectionAuthCard';
import CommerceCard from './CommerceCard';
import AdvancedPanel from './AdvancedPanel';

export default function ApplicationConfigPanel({
  disabled = false,
  onTestConnection,
  onConnectionStatusChange,
  commerceConfigured,
  connected,
  catalogs = [],
  channels = [],
  languages = [],
  currencies = [],
  onSelectChannel,
  onSelectCatalog,
  onRefreshLists,
  isCreatingChannel = false,
  onCreateDefaultChannel,
  connectionErrors = [],
  commerceErrors = [],
  onErrorsChange,
  onDeleteAllCommerceData,
  onDeleteSelectedCommerceData,
  batchSizes,
}) {
  const handleTest = async () => {
    try {
      const result = await onTestConnection(); // parent does GET + POSTs
      if (result)
        onConnectionStatusChange && onConnectionStatusChange(true, result);
    } catch (e) {
      onConnectionStatusChange && onConnectionStatusChange(false, e?.result);
      throw e;
    }
  };

  return (
    <div className="application-config grid grid-cols-1 gap-16">
      <ConnectionAuthCard
        disabled={disabled}
        connected={connected}
        onTestConnection={handleTest}
        errors={connectionErrors}
        onErrorsChange={onErrorsChange}
      />

      <CommerceCard
        disabled={disabled || !connected || isCreatingChannel}
        catalogs={catalogs}
        channels={channels}
        languages={languages}
        currencies={currencies}
        connected={!!connected}
        onSelectChannel={onSelectChannel}
        onSelectCatalog={onSelectCatalog}
        isCreatingChannel={isCreatingChannel}
        onCreateDefaultChannel={onCreateDefaultChannel}
        onRefresh={onRefreshLists}
        commerceConfigured={commerceConfigured}
        errors={commerceErrors}
      />

      <AdvancedPanel
        disabled={disabled || !connected}
        connected={!!connected}
        onDeleteAllCommerceData={onDeleteAllCommerceData}
        onDeleteSelectedCommerceData={onDeleteSelectedCommerceData}
        batchSizes={batchSizes}
      />
    </div>
  );
}
