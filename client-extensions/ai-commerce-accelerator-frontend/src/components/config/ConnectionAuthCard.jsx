import React, { useState } from 'react';
import ClayCard from '@clayui/card';
import ClayForm, { ClayInput } from '@clayui/form';
import { useApp } from '../../context/AppContext';

export default function ConnectionAuthCard({
  onTestConnection,
  disabled = false,
  openAiKeyAvailable,
}) {
  const { config, setConfig } = useApp();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | success | error

  const isHosted = !!config.liferayHosted;

  const onTest = async () => {
    if (disabled) return;
    setLoading(true);
    try {
      await onTestConnection(); // App.jsx owns the GET + POSTs
      setStatus('success');
    } catch {
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const displayType =
    status === 'success'
      ? 'success'
      : status === 'error'
      ? 'danger'
      : 'outline-primary';

  return (
    <ClayCard className="p-4">
      <h3 className="mb-3">Connection</h3>

      {!isHosted && (
        <>
          <ClayForm.Group>
            <label htmlFor="microserviceUrl" className="form-label">
              Microservice URL
            </label>
            <ClayInput
              id="microserviceUrl"
              aria-label="Microservice URL"
              value={config.microserviceUrl}
              onChange={(e) => setConfig({ microserviceUrl: e.target.value })}
              placeholder="http://localhost:3001"
              autoComplete="off"
              disabled={disabled || loading}
            />
          </ClayForm.Group>

          <div
            className="grid"
            style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}
          >
            <ClayForm.Group>
              <label htmlFor="clientId" className="form-label">
                Client ID (temporary)
              </label>
              <ClayInput
                id="clientId"
                aria-label="Client ID (temporary)"
                value={config.clientId || ''}
                onChange={(e) => setConfig({ clientId: e.target.value })}
                disabled={disabled || loading}
                autoComplete="off"
              />
            </ClayForm.Group>
            <ClayForm.Group>
              <label htmlFor="clientSecret" className="form-label">
                Client Secret (temporary)
              </label>
              <ClayInput
                id="clientSecret"
                aria-label="Client Secret (temporary)"
                type="password"
                value={config.clientSecret || ''}
                onChange={(e) => setConfig({ clientSecret: e.target.value })}
                disabled={disabled || loading}
                autoComplete="off"
              />
            </ClayForm.Group>
          </div>

          <div
            className="grid"
            style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}
          >
            <ClayForm.Group>
              <label htmlFor="localeCode" className="form-label">
                Locale
              </label>
              <ClayInput
                id="localeCode"
                aria-label="Locale"
                value={config.localeCode}
                onChange={(e) => setConfig({ localeCode: e.target.value })}
                placeholder="en-US"
                disabled={disabled || loading}
              />
            </ClayForm.Group>
            <ClayForm.Group>
              <label htmlFor="pollingDelay" className="form-label">
                Polling Delay (ms)
              </label>
              <ClayInput
                id="pollingDelay"
                aria-label="Polling Delay (ms)"
                type="number"
                min={250}
                step={50}
                value={config.pollingDelay}
                onChange={(e) =>
                  setConfig({
                    pollingDelay: Math.max(250, Number(e.target.value) || 250),
                  })
                }
                disabled={disabled || loading}
              />
            </ClayForm.Group>
            <ClayForm.Group>
              <label htmlFor="liferayUrl" className="form-label">
                Liferay URL
              </label>
              <ClayInput
                id="liferayUrl"
                aria-label="Liferay URL"
                value={config.liferayUrl}
                onChange={(e) => setConfig({ liferayUrl: e.target.value })}
                placeholder="http://localhost:8080"
                disabled={disabled || loading}
              />
            </ClayForm.Group>
          </div>
        </>
      )}

      <button
        type="button"
        className={`btn w-100 btn-${displayType}`}
        onClick={onTest}
        disabled={disabled || loading}
      >
        <i
          className={`fas ${
            status === 'success' ? 'fa-check' : 'fa-plug'
          } me-2`}
        ></i>
        {status === 'success'
          ? 'Connected ✓'
          : status === 'error'
          ? 'Retry Connection'
          : 'Test Connection & Load Data'}
      </button>
    </ClayCard>
  );
}
