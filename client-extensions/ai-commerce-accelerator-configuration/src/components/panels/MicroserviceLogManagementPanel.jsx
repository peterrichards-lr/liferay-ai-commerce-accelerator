import React, { useState, useEffect, useCallback } from 'react';
import ClayButton from '@clayui/button';
import ClayForm, { ClayInput, ClaySelect } from '@clayui/form';
import ClayIcon from '@clayui/icon';
import ClayLayout from '@clayui/layout';
import { useApi } from '../../hooks/useMicroserviceApi';
import { useObjectStorage } from '../../hooks/useObjectStorage';
import {
  LOGS_SETTINGS,
  LOGS_CYCLE,
  LOGS_DOWNLOAD,
  LOGS_CLEAR,
} from '../../utils/microservicePaths';

const MICROSERVICE_CONFIG_KEY = 'microservice-config';
const DEFAULTS = {
  [MICROSERVICE_CONFIG_KEY]: {
    url: 'http://localhost:3001',
  },
};

function MicroserviceLogManagementPanel() {
  const {
    loading: loadingConfig,
    saving: savingConfig,
    values: { [MICROSERVICE_CONFIG_KEY]: msConfig },
    setValue: setMsConfigValue,
    onSave: onSaveMsConfig,
    dirty: dirtyMsConfig,
  } = useObjectStorage({
    keys: [MICROSERVICE_CONFIG_KEY],
    defaults: DEFAULTS,
  });

  const api = useApi(msConfig?.url);
  const [loading, setLoading] = useState(false);
  const [savingLogs, setSavingLogs] = useState(false);
  const [cycling, setCycling] = useState(false);
  const [logsConfig, setLogsConfig] = useState({
    enabled: true,
    retentionCount: 10,
    autoCycleTime: '00:00',
  });

  const fetchSettings = useCallback(async () => {
    if (!msConfig?.url) return;
    setLoading(true);
    try {
      const res = await api.post(LOGS_SETTINGS, {});
      if (res?.success) {
        setLogsConfig(res.config);
      }
    } catch (err) {
      console.error('Failed to fetch log settings:', err);
    } finally {
      setLoading(false);
    }
  }, [api, msConfig?.url]);

  useEffect(() => {
    if (!loadingConfig) {
      fetchSettings();
    }
  }, [fetchSettings, loadingConfig]);

  const handleSaveMsUrl = async () => {
    try {
      await onSaveMsConfig();
      Liferay?.Util?.openToast?.({
        message: 'Microservice URL updated.',
        type: 'success',
      });
    } catch (err) {
      Liferay?.Util?.openToast?.({
        message: `Failed to update URL: ${err.message}`,
        type: 'danger',
      });
    }
  };

  const handleSaveLogsSettings = async () => {
    setSavingLogs(true);
    try {
      const res = await api.put(LOGS_SETTINGS, logsConfig);
      if (res?.success) {
        Liferay?.Util?.openToast?.({
          message: 'Microservice log settings updated.',
          type: 'success',
        });
      }
    } catch (err) {
      Liferay?.Util?.openToast?.({
        message: `Failed to update log settings: ${err.message}`,
        type: 'danger',
      });
    } finally {
      setSavingLogs(false);
    }
  };

  const handleCycleNow = async () => {
    setCycling(true);
    try {
      const res = await api.post(LOGS_CYCLE, {});
      if (res?.success) {
        Liferay?.Util?.openToast?.({
          message: 'Microservice logs cycled successfully.',
          type: 'success',
        });
      }
    } catch (err) {
      Liferay?.Util?.openToast?.({
        message: `Failed to cycle logs: ${err.message}`,
        type: 'danger',
      });
    } finally {
      setCycling(false);
    }
  };

  const handleDownloadLogs = async () => {
    try {
      const res = await api.get(LOGS_DOWNLOAD, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'microservice-app.log');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Failed to download logs:', err);
      Liferay?.Util?.openToast?.({
        message: 'Failed to download logs',
        type: 'danger',
      });
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('Clear all logs? This cannot be undone.')) return;
    try {
      await api.del(LOGS_CLEAR);
      Liferay?.Util?.openToast?.({
        message: 'Logs cleared.',
        type: 'success',
      });
    } catch (err) {
      console.error('Failed to clear logs:', err);
      Liferay?.Util?.openToast?.({
        message: 'Failed to clear logs',
        type: 'danger',
      });
    }
  };

  if (loadingConfig) {
    return <div className="p-5 text-center">Loading configuration...</div>;
  }

  return (
    <ClayLayout.Sheet aria-busy={loading || savingLogs || savingConfig}>
      <div className="sheet-header">
        <h2 className="sheet-title">Microservice Log Management</h2>
        <div className="sheet-text">
          Configure how the Node.js Microservice handles its internal debug
          logs.
        </div>
      </div>

      <div className="sheet-section">
        <h3 className="sheet-subtitle">Connectivity</h3>
        <ClayForm.Group>
          <label htmlFor="ms-url">Microservice Base URL</label>
          <div className="d-flex">
            <ClayInput
              id="ms-url"
              type="url"
              value={msConfig.url}
              onChange={(e) =>
                setMsConfigValue(MICROSERVICE_CONFIG_KEY, {
                  ...msConfig,
                  url: e.target.value,
                })
              }
              placeholder="http://localhost:3001"
            />
            <ClayButton
              displayType="primary"
              className="ml-2"
              onClick={handleSaveMsUrl}
              disabled={!dirtyMsConfig || savingConfig}
            >
              Update
            </ClayButton>
          </div>
          <small className="form-text text-secondary">
            Stored in Liferay as <code>{MICROSERVICE_CONFIG_KEY}</code>.
          </small>
        </ClayForm.Group>
      </div>

      <div className="sheet-section mt-4 border-top pt-4">
        <h3 className="sheet-subtitle">Log Rotation & Retention</h3>
        <div className="alert alert-info border-0 shadow-sm small mb-4">
          <strong>Note:</strong> These settings only apply to the Node.js
          Microservice debug logs (diagnostics). State Machine audit logs and
          Liferay instance logs are managed separately.
        </div>

        <ClayForm.Group>
          <div className="custom-control custom-checkbox mb-3">
            <input
              type="checkbox"
              className="custom-control-input"
              id="logsEnabled"
              checked={logsConfig.enabled}
              onChange={(e) =>
                setLogsConfig({ ...logsConfig, enabled: e.target.checked })
              }
            />
            <label className="custom-control-label" htmlFor="logsEnabled">
              Enable daily automatic log cycling
            </label>
          </div>
        </ClayForm.Group>

        <div className="row">
          <div className="col-md-6">
            <ClayForm.Group>
              <label htmlFor="autoCycleTime">Daily Cycle Time (24h)</label>
              <ClayInput
                id="autoCycleTime"
                type="time"
                value={logsConfig.autoCycleTime}
                onChange={(e) =>
                  setLogsConfig({
                    ...logsConfig,
                    autoCycleTime: e.target.value,
                  })
                }
                disabled={!logsConfig.enabled}
              />
            </ClayForm.Group>
          </div>
          <div className="col-md-6">
            <ClayForm.Group>
              <label htmlFor="retentionCount">Log Retention (Files)</label>
              <ClaySelect
                id="retentionCount"
                value={logsConfig.retentionCount}
                onChange={(e) =>
                  setLogsConfig({
                    ...logsConfig,
                    retentionCount: parseInt(e.target.value, 10),
                  })
                }
              >
                {[5, 10, 20, 30, 50].map((v) => (
                  <ClaySelect.Option key={v} label={v.toString()} value={v} />
                ))}
              </ClaySelect>
            </ClayForm.Group>
          </div>
        </div>

        <div className="mt-3">
          <ClayButton
            displayType="primary"
            onClick={handleSaveLogsSettings}
            disabled={savingLogs || !msConfig?.url}
          >
            {savingLogs && (
              <span className="spinner-border spinner-border-sm mr-2" />
            )}
            Save Log Settings
          </ClayButton>
        </div>
      </div>

      <div className="sheet-section mt-4 border-top pt-4">
        <h3 className="sheet-subtitle">Actions</h3>
        <div className="d-flex flex-wrap gap-2">
          <ClayButton
            displayType="secondary"
            onClick={handleCycleNow}
            disabled={cycling || !msConfig?.url}
            className="mr-2"
          >
            {cycling ? (
              <span className="spinner-border spinner-border-sm mr-2" />
            ) : (
              <ClayIcon symbol="reload" className="mr-2" />
            )}
            Cycle Logs Now
          </ClayButton>

          <ClayButton
            displayType="secondary"
            onClick={handleDownloadLogs}
            disabled={!msConfig?.url}
            className="mr-2"
          >
            <ClayIcon symbol="download" className="mr-2" />
            Download Global Logs
          </ClayButton>

          <ClayButton
            displayType="secondary"
            onClick={handleClearLogs}
            disabled={!msConfig?.url}
            className="mr-2"
          >
            <ClayIcon symbol="hr-trash" className="mr-2" />
            Clear Logs
          </ClayButton>
        </div>
      </div>
    </ClayLayout.Sheet>
  );
}

export default MicroserviceLogManagementPanel;
