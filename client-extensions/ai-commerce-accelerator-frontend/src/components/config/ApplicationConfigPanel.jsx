// src/components/config/ApplicationConfigPanel.jsx
import React from 'react';
import ConnectionAuthCard from './ConnectionAuthCard';
import CommerceCard from './CommerceCard';
import AdvancedPanel from './AdvancedPanel';
import { useApp } from '../../context/AppContext';

export default function ApplicationConfigPanel({
  disabled = false,
  generationConfig,
  onTestConnection,
  onConnectionStatusChange,
  commerceConfigured,
  connected,
  catalogs = [],
  channels = [],
  languages = [],
  currencies = [],
  onSelectChannel,
  connectionErrors = [],
  commerceErrors = [],
  onErrorsChange,
  onClearCommerceData,
}) {
  const { config } = useApp();

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
        onTestConnection={handleTest}
        errors={connectionErrors}
        onErrorsChange={onErrorsChange}
      />

      <CommerceCard
        disabled={disabled || !connected}
        catalogs={catalogs}
        channels={channels}
        languages={languages}
        currencies={currencies}
        connected={!!connected}
        onSelectChannel={onSelectChannel}
        commerceConfigured={commerceConfigured}
        errors={commerceErrors}
      />

      <AdvancedPanel
        disabled={disabled}
        connected={!!connected}
        generationConfig={generationConfig}
        onClearCommerceData={onClearCommerceData}
      />
    </div>
  );
}
