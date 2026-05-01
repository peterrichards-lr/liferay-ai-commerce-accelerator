import React, { useState } from 'react';
import ClayCard from '@clayui/card';
import ClayForm, { ClayInput } from '@clayui/form';
import { useApp } from '../../context/AppContext';
import FieldError from '../ui/FieldError';
import { getConnectionErrorsMap } from '../../utils/validation';

export default function ConnectionAuthCard({
  onTestConnection,
  disabled = false,
  errors,
  onErrorsChange,
}) {
  const { config, setConfig } = useApp();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | success | error

  const isHosted = !!config.liferayHosted;

  const update = (patch) => {
    const next = { ...config, ...patch };
    setConfig(patch);
    const map = getConnectionErrorsMap(next, isHosted);
    onErrorsChange?.(map);
  };

  const handleBlur = () => {
    const map = getConnectionErrorsMap(config);
    onErrorsChange?.(map);
  };

  const onTest = async () => {
    if (disabled) return;
    setLoading(true);
    try {
      await onTestConnection();
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
              onBlur={handleBlur}
              onChange={(e) => update({ microserviceUrl: e.target.value })}
              placeholder="http://localhost:3001"
              autoComplete="off"
              disabled={disabled || loading}
            />
            <FieldError errors={errors.microserviceUrl} />
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
                onBlur={handleBlur}
                onChange={(e) => update({ clientId: e.target.value })}
                disabled={disabled || loading}
                autoComplete="off"
              />
              <FieldError errors={errors.clientId} />
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
                onBlur={handleBlur}
                onChange={(e) => update({ clientSecret: e.target.value })}
                disabled={disabled || loading}
                autoComplete="off"
              />
              <FieldError errors={errors.clientSecret} />
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
                onBlur={handleBlur}
                onChange={(e) => update({ localeCode: e.target.value })}
                placeholder="en-US"
                disabled={disabled || loading}
              />
              <FieldError errors={errors.localeCode} />
            </ClayForm.Group>
            <ClayForm.Group>
              <label htmlFor="pollingDelay" className="form-label">
                Polling Delay (ms)
              </label>
              <ClayInput
                id="pollingDelay"
                aria-label="Polling Delay (ms)"
                type="number"
                min={5000}
                step={500}
                value={config.pollingDelay}
                onBlur={handleBlur}
                onChange={(e) =>
                  update({
                    pollingDelay: Math.max(
                      5000,
                      Number(e.target.value) || 5000
                    ),
                  })
                }
                disabled={disabled || loading}
              />
              <FieldError errors={errors.pollingDelay} />
            </ClayForm.Group>
            <ClayForm.Group>
              <label htmlFor="liferayUrl" className="form-label">
                Liferay URL
              </label>
              <ClayInput
                id="liferayUrl"
                aria-label="Liferay URL"
                value={config.liferayUrl}
                onBlur={handleBlur}
                onChange={(e) => update({ liferayUrl: e.target.value })}
                placeholder="http://localhost:8080"
                disabled={disabled || loading}
              />
              <FieldError errors={errors.liferayUrl} />
            </ClayForm.Group>
          </div>
        </>
      )}

      <button
        type="button"
        className={`btn w-100 btn-${displayType} my-2 py-2`}
        onClick={onTest}
        disabled={disabled || loading}
      >
        <i
          className={`icon ${
            displayType === 'success'
              ? 'icon-connected'
              : displayType === 'danger'
                ? 'icon-connection-failed'
                : 'icon-connection-unknown'
          } me-2`}
        ></i>
        {status === 'success'
          ? 'Connected'
          : status === 'error'
            ? 'Retry Connection'
            : 'Test Connection & Load Data'}
      </button>
    </ClayCard>
  );
}
