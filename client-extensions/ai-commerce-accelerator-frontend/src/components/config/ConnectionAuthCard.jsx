import React, { useState } from 'react';
import ClayCard from '@clayui/card';
import ClayForm, { ClayInput } from '@clayui/form';
import { useApp } from '../../context/AppContext';
import FieldError from '../ui/FieldError';
import { getConnectionErrorsMap } from '../../utils/validation';

export default function ConnectionAuthCard({
  onTestConnection,
  disabled = false,
  connected = false,
  errors,
  onErrorsChange,
}) {
  const { config, setConfig } = useApp();
  const [loading, setLoading] = useState(false);
  const [testFailed, setTestFailed] = useState(false);

  const status = loading
    ? 'idle'
    : testFailed
      ? 'error'
      : connected
        ? 'success'
        : 'idle';

  const isHosted = !!config.liferayHosted;
  const [targetType, setTargetType] = useState('local'); // 'local' or 'remote'

  const update = (patch) => {
    const next = { ...config, ...patch };
    setConfig(patch);
    const map = getConnectionErrorsMap(next, isHosted);
    onErrorsChange?.(map);
  };

  const handleTargetTypeChange = (type) => {
    setTargetType(type);
    if (type === 'local') {
      const defaultLiferayUrl = isHosted
        ? config.liferayUrl || window.location.origin
        : 'http://localhost:8080';
      update({
        clientId: '',
        clientSecret: '',
        liferayUrl: defaultLiferayUrl,
      });
    }
  };

  const handleBlur = () => {
    const map = getConnectionErrorsMap(config);
    onErrorsChange?.(map);
  };

  const onTest = async () => {
    if (disabled) return;
    setLoading(true);
    setTestFailed(false);
    try {
      await onTestConnection();
    } catch {
      setTestFailed(true);
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

      {isHosted && (
        <ClayForm.Group className="mb-4">
          <label className="form-label font-weight-bold d-block mb-2">
            Target DXP Instance
          </label>
          <div className="d-flex align-items-center">
            <div className="custom-control custom-radio custom-control-inline me-4">
              <input
                checked={targetType === 'local'}
                className="custom-control-input"
                id="targetTypeLocal"
                name="targetType"
                onChange={() => handleTargetTypeChange('local')}
                type="radio"
                disabled={disabled || loading}
              />
              <label className="custom-control-label" htmlFor="targetTypeLocal">
                <span className="custom-control-label-text">
                  This Liferay Instance (Local)
                </span>
              </label>
            </div>
            <div className="custom-control custom-radio custom-control-inline">
              <input
                checked={targetType === 'remote'}
                className="custom-control-input"
                id="targetTypeRemote"
                name="targetType"
                onChange={() => handleTargetTypeChange('remote')}
                type="radio"
                disabled={disabled || loading}
              />
              <label
                className="custom-control-label"
                htmlFor="targetTypeRemote"
              >
                <span className="custom-control-label-text">
                  A Different Liferay Instance (Remote)
                </span>
              </label>
            </div>
          </div>
        </ClayForm.Group>
      )}

      {(!isHosted || targetType === 'remote') && (
        <>
          {!isHosted && (
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
          )}

          <div
            className="grid"
            style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}
          >
            <ClayForm.Group>
              <label htmlFor="clientId" className="form-label">
                Client ID {isHosted ? '' : '(temporary)'}
              </label>
              <ClayInput
                id="clientId"
                aria-label="Client ID"
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
                Client Secret {isHosted ? '' : '(temporary)'}
              </label>
              <ClayInput
                id="clientSecret"
                aria-label="Client Secret"
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
            style={{
              gridTemplateColumns: isHosted ? '1fr' : '1fr 1fr 1fr',
              gap: 12,
            }}
          >
            {!isHosted && (
              <>
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
              </>
            )}
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
