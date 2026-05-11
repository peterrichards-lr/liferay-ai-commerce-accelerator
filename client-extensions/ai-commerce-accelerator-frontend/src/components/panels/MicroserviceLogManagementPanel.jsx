import React, { useState, useEffect, useCallback } from 'react';
import ClayCard from '@clayui/card';
import ClayButton from '@clayui/button';
import ClayForm, { ClayInput, ClaySelect } from '@clayui/form';
import ClayIcon from '@clayui/icon';
import { useApi } from '../../context/AppContext';
import { LOGS_SETTINGS, LOGS_CYCLE } from '../../utils/microservicePaths';
import notifyUser from '../../utils/notifications';

function MicroserviceLogManagementPanel() {
  const api = useApi();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cycling, setCycling] = useState(false);
  const [config, setConfig] = useState({
    enabled: true,
    retentionCount: 10,
    autoCycleTime: '00:00',
  });

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post(LOGS_SETTINGS, {});
      if (res?.success) {
        setConfig(res.config);
      }
    } catch (err) {
      console.error('Failed to fetch log settings:', err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.put(LOGS_SETTINGS, config);
      if (res?.success) {
        notifyUser('SUCCESS', 'Microservice log settings updated.');
      }
    } catch (err) {
      notifyUser('ERROR', `Failed to update log settings: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCycleNow = async () => {
    setCycling(true);
    try {
      const res = await api.post(LOGS_CYCLE, {});
      if (res?.success) {
        notifyUser('SUCCESS', 'Microservice logs cycled successfully.');
      }
    } catch (err) {
      notifyUser('ERROR', `Failed to cycle logs: ${err.message}`);
    } finally {
      setCycling(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center p-5">
        <span className="spinner-border text-primary" role="status" />
        <div className="mt-2">Loading log settings...</div>
      </div>
    );
  }

  return (
    <ClayCard>
      <ClayCard.Body>
        <div className="d-flex align-items-center mb-4">
          <div className="bg-light p-2 rounded mr-3">
            <ClayIcon
              symbol="list"
              style={{ width: '24px', height: '24px' }}
              className="text-primary"
            />
          </div>
          <div>
            <h4 className="mb-0">Microservice Log Management</h4>
            <div className="text-muted small">
              Configure automatic and manual cycling of application debug logs.
            </div>
          </div>
        </div>

        <div className="alert alert-info border-0 shadow-sm small mb-4">
          <strong>Note:</strong> These settings only apply to the Node.js
          Microservice debug logs (diagnostics). State Machine audit logs and
          Liferay instance logs are managed separately.
        </div>

        <ClayForm.Group>
          <label className="font-weight-bold mb-2">Automatic Log Cycling</label>
          <div className="custom-control custom-checkbox mb-3">
            <input
              type="checkbox"
              className="custom-control-input"
              id="logsEnabled"
              checked={config.enabled}
              onChange={(e) =>
                setConfig({ ...config, enabled: e.target.checked })
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
                value={config.autoCycleTime}
                onChange={(e) =>
                  setConfig({ ...config, autoCycleTime: e.target.value })
                }
                disabled={!config.enabled}
              />
              <ClayForm.FeedbackGroup>
                <ClayForm.Text>
                  The exact time of day to archive the current log file.
                </ClayForm.Text>
              </ClayForm.FeedbackGroup>
            </ClayForm.Group>
          </div>
          <div className="col-md-6">
            <ClayForm.Group>
              <label htmlFor="retentionCount">Log Retention (Files)</label>
              <ClaySelect
                id="retentionCount"
                value={config.retentionCount}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    retentionCount: parseInt(e.target.value, 10),
                  })
                }
              >
                {[5, 10, 20, 30, 50].map((v) => (
                  <ClaySelect.Option key={v} label={v.toString()} value={v} />
                ))}
              </ClaySelect>
              <ClayForm.FeedbackGroup>
                <ClayForm.Text>
                  Number of archived log files to keep on the server.
                </ClayForm.Text>
              </ClayForm.FeedbackGroup>
            </ClayForm.Group>
          </div>
        </div>

        <hr className="my-4" />

        <div className="d-flex justify-content-between align-items-center">
          <div>
            <ClayButton
              displayType="secondary"
              onClick={handleCycleNow}
              disabled={cycling}
              className="mr-2"
            >
              {cycling ? (
                <span className="spinner-border spinner-border-sm mr-2" />
              ) : (
                <ClayIcon symbol="reload" className="mr-2" />
              )}
              Cycle Logs Now
            </ClayButton>
          </div>
          <ClayButton
            displayType="primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <span className="spinner-border spinner-border-sm mr-2" />
            ) : (
              <ClayIcon symbol="check" className="mr-2" />
            )}
            Save Log Settings
          </ClayButton>
        </div>
      </ClayCard.Body>
    </ClayCard>
  );
}

export default MicroserviceLogManagementPanel;
