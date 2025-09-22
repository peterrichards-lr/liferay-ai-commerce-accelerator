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
  connected,
  catalogs = [],
  channels = [],
  languages = [],
  currencies = [],
  onSelectChannel,
}) {
  const { config } = useApp();

  const handleTest = async () => {
    try {
      const result = await onTestConnection(); // parent does GET + POSTs
      onConnectionStatusChange && onConnectionStatusChange(true, result);
    } catch (e) {
      onConnectionStatusChange && onConnectionStatusChange(false, e?.result);
      throw e;
    }
  };

  return (
    <div className="application-config grid grid-cols-1 gap-16">
      {/* Connection is always rendered; hides inputs internally when hosted */}
      <ConnectionAuthCard disabled={disabled} onTestConnection={handleTest} />

      <CommerceCard
        disabled={disabled || !connected}
        catalogs={catalogs}
        channels={channels}
        languages={languages}
        currencies={currencies}
        connected={!!connected}
        onSelectChannel={onSelectChannel}
      />

      {/* Advanced is always available */}
      <AdvancedPanel disabled={disabled} generationConfig={generationConfig} />
    </div>
  );
}
