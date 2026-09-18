// src/components/config/ApplicationConfigPanel.jsx
import React from 'react';
import ConnectionAuthCard from './ConnectionAuthCard';
import ConfigurationSourceCard from './ConfigurationSourceCard';
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
  sites = [],
  onSelectChannel,
  onSelectCatalog,
  onRefreshLists,
  isCreatingCommerce = false,
  onCreateCommerceSetup,
  onLoadSiteLanguages,
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

      {/* Second in the setup rail, in the order it has to be satisfied:
          which Liferay, then where its settings come from, then commerce.
          See #903 §2.1. */}
      <ConfigurationSourceCard disabled={disabled} />

      <CommerceCard
        disabled={disabled || !connected || isCreatingCommerce}
        catalogs={catalogs}
        channels={channels}
        languages={languages}
        currencies={currencies}
        sites={sites}
        connected={!!connected}
        onSelectChannel={onSelectChannel}
        onSelectCatalog={onSelectCatalog}
        isCreatingCommerce={isCreatingCommerce}
        onCreateCommerceSetup={onCreateCommerceSetup}
        onLoadSiteLanguages={onLoadSiteLanguages}
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
