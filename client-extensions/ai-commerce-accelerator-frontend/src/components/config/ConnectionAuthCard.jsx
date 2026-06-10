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
    const map = getConnectionErrorsMap(next, isHosted ? targetType : 'remote');
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
    const map = getConnectionErrorsMap(
      config,
      isHosted ? targetType : 'remote'
    );
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
          <div className="d-flex align-items-start flex-column gap-2">
            <div className="custom-control custom-radio mb-2">
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
                <span className="custom-control-label-text font-weight-bold">
                  Preconfigured Server Default
                </span>
                <small className="form-text text-muted d-block mt-1">
                  Connects automatically using the pre-configured .env
                  parameters on the microservice server.
                </small>
              </label>
            </div>
            <div className="custom-control custom-radio">
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
                <span className="custom-control-label-text font-weight-bold">
                  Custom Liferay Instance (Override)
                </span>
                <small className="form-text text-muted d-block mt-1">
                  Target a different Liferay DXP server by explicitly providing
                  its URL and OAuth credentials.
                </small>
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
                Microservice URL <span className="text-danger">*</span>
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
                Client ID <span className="text-danger">*</span>
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
                Client Secret <span className="text-danger">*</span>
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
                    Locale <span className="text-danger">*</span>
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
                    Polling Delay (ms) <span className="text-danger">*</span>
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
                Liferay URL <span className="text-danger">*</span>
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
