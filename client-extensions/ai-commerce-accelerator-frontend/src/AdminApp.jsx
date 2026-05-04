import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ClayLayout from '@clayui/layout';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayTable from '@clayui/table';
import ClayCard from '@clayui/card';
import ClayLabel from '@clayui/label';
import { useApp, useApi, AppProvider } from './context/AppContext';
import notifyUser from './utils/notifications';
import { buildFilename, exportJsonFile } from './utils/fileHelper';
import {
  WORKFLOW_SESSIONS,
  WORKFLOW_KPIS,
  CONFIG_HEALTH,
  EXPORT_COMMERCE_DATA,
} from './utils/microservicePaths';

function AdminUI() {
  const { config } = useApp();
  const api = useApi();

  const [sessions, setSessions] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectionEstablished, setConnectionEstablished] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [sortConfig, setSortConfig] = useState({
    key: 'created_at',
    direction: 'desc',
  });
  const [filters, setSortFilters] = useState({ name: '', status: '' });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setConnectionError(null);
    try {
      const [sessionsRes, kpisRes, healthRes] = await Promise.all([
        api.get(WORKFLOW_SESSIONS),
        api.get(WORKFLOW_KPIS),
        api.get(CONFIG_HEALTH),
      ]);

      if (sessionsRes?.success) setSessions(sessionsRes.sessions || []);
      if (kpisRes?.success) setKpis(kpisRes.kpis);
      if (healthRes?.success) setHealth(healthRes.health);

      setConnectionEstablished(true);
    } catch (err) {
      console.error('Failed to load admin data:', err);
      setConnectionEstablished(false);
      setConnectionError(
        `Unable to reach microservice at ${config.microserviceUrl}. Please ensure the server is running and accessible.`
      );
      notifyUser('Failed to load dashboard data', 'danger');
    } finally {
      setLoading(false);
    }
  }, [api, config.microserviceUrl]);

  useEffect(() => {
    Promise.resolve().then(() => fetchData());
  }, [fetchData]);

  const handleExport = async (sessionId, name) => {
    try {
      const res = await api.get(
        `${EXPORT_COMMERCE_DATA}?sessionId=${sessionId}`
      );
      const filename = buildFilename(`aica-dataset-${name || sessionId}`);
      exportJsonFile(res, filename);
      notifyUser('Dataset exported successfully');
    } catch {
      notifyUser('Failed to export dataset', 'danger');
    }
  };

  const filteredSessions = useMemo(() => {
    return sessions
      .filter((s) => {
        const nameMatch = (s.session_name || s.session_id)
          .toLowerCase()
          .includes(filters.name.toLowerCase());
        const statusMatch = !filters.status || s.status === filters.status;
        return nameMatch && statusMatch;
      })
      .sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
  }, [sessions, sortConfig, filters]);

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  if (!connectionEstablished && !loading) {
    return (
      <div className="admin-dashboard p-5 d-flex align-items-center justify-content-center min-vh-50">
        <ClayCard style={{ maxWidth: '500px', width: '100%' }}>
          <ClayCard.Body className="text-center p-5">
            <div
              className="bg-light rounded-circle d-inline-flex align-items-center justify-content-center mb-4 text-warning"
              style={{ width: '80px', height: '80px' }}
            >
              <ClayIcon
                symbol="exclamation-full"
                style={{ width: '40px', height: '40px' }}
              />
            </div>
            <h2 className="font-weight-bold mb-3">Not Connected</h2>
            <p className="text-secondary mb-4">
              The administration dashboard requires a live connection to the AI
              Commerce Microservice to retrieve system data.
            </p>

            {connectionError && (
              <div className="alert alert-danger text-left small mb-4">
                <ClayIcon symbol="info-circle" className="mr-2" />
                {connectionError}
              </div>
            )}

            <ClayButton
              displayType="primary"
              block
              onClick={fetchData}
              disabled={loading}
            >
              {loading ? (
                <span
                  className="spinner-border spinner-border-sm mr-2"
                  role="status"
                />
              ) : (
                <ClayIcon symbol="reload" className="mr-2" />
              )}
              Try Reconnect
            </ClayButton>
          </ClayCard.Body>
        </ClayCard>
      </div>
    );
  }

  return (
    <div className="admin-dashboard p-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 className="h3 mb-0 font-weight-bold">System Administration</h1>
          <p className="text-secondary mb-0">
            Monitor sessions, configuration health, and system KPIs
          </p>
        </div>
        <ClayButton
          displayType="secondary"
          onClick={fetchData}
          disabled={loading}
        >
          <ClayIcon symbol="reload" className="mr-2" />
          Refresh Data
        </ClayButton>
      </div>

      {/* KPI METRICS */}
      <ClayLayout.Row className="mb-4">
        <ClayLayout.Col md={3}>
          <KPICard
            title="Total Sessions"
            value={kpis?.totalSessions || 0}
            icon=" list"
          />
        </ClayLayout.Col>
        <ClayLayout.Col md={3}>
          <KPICard
            title="Success Rate"
            value={`${Math.round(kpis?.successRate || 0)}%`}
            icon="check-circle"
            color="text-success"
          />
        </ClayLayout.Col>
        <ClayLayout.Col md={3}>
          <KPICard
            title="Failed Sessions"
            value={kpis?.failedSessions || 0}
            icon="times-circle"
            color="text-danger"
          />
        </ClayLayout.Col>
        <ClayLayout.Col md={3}>
          <KPICard
            title="Cancelled"
            value={kpis?.cancelledSessions || 0}
            icon="hr"
            color="text-warning"
          />
        </ClayLayout.Col>
      </ClayLayout.Row>

      <ClayLayout.Row>
        {/* DOCTOR / TROUBLESHOOTING */}
        <ClayLayout.Col lg={4}>
          <ConfigurationDoctor health={health} liferayUrl={config.liferayUrl} />
        </ClayLayout.Col>

        {/* SESSION EXPLORER */}
        <ClayLayout.Col lg={8}>
          <ClayCard>
            <ClayCard.Body>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h4 className="mb-0">Session Explorer</h4>
                <div className="d-flex gap-2">
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    placeholder="Filter by name..."
                    style={{ width: '200px' }}
                    value={filters.name}
                    onChange={(e) =>
                      setSortFilters((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                  <select
                    className="form-control form-control-sm"
                    style={{ width: '150px' }}
                    value={filters.status}
                    onChange={(e) =>
                      setSortFilters((f) => ({ ...f, status: e.target.value }))
                    }
                  >
                    <option value="">All Statuses</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="FAILED">Failed</option>
                    <option value="CANCELLED">Cancelled</option>
                    <option value="STARTED">Started</option>
                  </select>
                </div>
              </div>

              <div className="table-responsive">
                <ClayTable>
                  <ClayTable.Head>
                    <ClayTable.Row>
                      <ClayTable.Cell
                        headingCell
                        onClick={() => requestSort('session_name')}
                        style={{ cursor: 'pointer' }}
                      >
                        Name / ID{' '}
                        {sortConfig.key === 'session_name' &&
                          (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </ClayTable.Cell>
                      <ClayTable.Cell
                        headingCell
                        onClick={() => requestSort('status')}
                        style={{ cursor: 'pointer' }}
                      >
                        Status{' '}
                        {sortConfig.key === 'status' &&
                          (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </ClayTable.Cell>
                      <ClayTable.Cell
                        headingCell
                        onClick={() => requestSort('created_at')}
                        style={{ cursor: 'pointer' }}
                      >
                        Date{' '}
                        {sortConfig.key === 'created_at' &&
                          (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </ClayTable.Cell>
                      <ClayTable.Cell headingCell />
                    </ClayTable.Row>
                  </ClayTable.Head>
                  <ClayTable.Body>
                    {filteredSessions.map((s) => (
                      <ClayTable.Row key={s.session_id}>
                        <ClayTable.Cell>
                          <div className="font-weight-bold">
                            {s.session_name || 'Unnamed'}
                          </div>
                          <small className="text-muted">{s.session_id}</small>
                        </ClayTable.Cell>
                        <ClayTable.Cell>
                          <StatusBadge status={s.status} />
                        </ClayTable.Cell>
                        <ClayTable.Cell style={{ fontSize: '0.875rem' }}>
                          {new Date(s.created_at).toLocaleString()}
                        </ClayTable.Cell>
                        <ClayTable.Cell className="text-right">
                          <ClayButton
                            displayType="unstyled"
                            size="sm"
                            onClick={() =>
                              handleExport(s.session_id, s.session_name)
                            }
                          >
                            <ClayIcon symbol="download" />
                          </ClayButton>
                        </ClayTable.Cell>
                      </ClayTable.Row>
                    ))}
                    {filteredSessions.length === 0 && (
                      <ClayTable.Row>
                        <ClayTable.Cell
                          colSpan={4}
                          className="text-center p-4 text-muted"
                        >
                          No sessions found matching filters.
                        </ClayTable.Cell>
                      </ClayTable.Row>
                    )}
                  </ClayTable.Body>
                </ClayTable>
              </div>
            </ClayCard.Body>
          </ClayCard>
        </ClayLayout.Col>
      </ClayLayout.Row>
    </div>
  );
}

function KPICard({ title, value, icon, color = 'text-primary' }) {
  return (
    <ClayCard>
      <ClayCard.Body className="p-3">
        <div className="d-flex align-items-center">
          <div
            className={`mr-3 rounded-circle bg-light d-flex align-items-center justify-content-center ${color}`}
            style={{ width: '48px', height: '48px' }}
          >
            <ClayIcon symbol={icon} />
          </div>
          <div>
            <div className="small text-secondary font-weight-bold text-uppercase">
              {title}
            </div>
            <div className="h3 mb-0 font-weight-bold">{value}</div>
          </div>
        </div>
      </ClayCard.Body>
    </ClayCard>
  );
}

function StatusBadge({ status }) {
  let displayType = 'info';
  if (status === 'COMPLETED') displayType = 'success';
  if (status === 'FAILED') displayType = 'danger';
  if (status === 'CANCELLED') displayType = 'warning';

  return <ClayLabel displayType={displayType}>{status}</ClayLabel>;
}

function ConfigurationDoctor({ health, liferayUrl }) {
  if (!health) return null;

  const configUrl = `${liferayUrl}/group/guest/~/control_panel/manage?p_p_id=com_liferay_client_extension_web_internal_portlet_ClientExtensionEntryPortlet_30394841094851_LXC_liferay_ai_commerce_accelerator_configuration&p_p_lifecycle=0&p_p_state=maximized#ai-config`;

  return (
    <ClayCard>
      <ClayCard.Body>
        <h4 className="mb-3 d-flex align-items-center">
          <ClayIcon symbol="first-aid" className="mr-2 text-danger" />
          Configuration Doctor
        </h4>

        <div className="list-group list-group-flush">
          <HealthItem
            title="Liferay Connectivity"
            status={
              health.liferay.status === 'CONNECTED' ? 'success' : 'danger'
            }
            message={health.liferay.message || 'Ready for population'}
          />
          <HealthItem
            title="AI Text (Core)"
            status={
              health.aiText.status === 'CONFIGURED' ? 'success' : 'danger'
            }
            message={`${health.aiText.provider} provider active`}
          />
          <HealthItem
            title="AI Media"
            status={
              health.aiMedia.status === 'CONFIGURED' ? 'success' : 'danger'
            }
            message={
              health.aiMedia.provider === 'inherit'
                ? 'Inheriting from Core AI'
                : `${health.aiMedia.provider} provider active`
            }
          />
          <HealthItem
            title="AI Prompts"
            status={health.prompts.status === 'OK' ? 'success' : 'warning'}
            message={
              health.prompts.missing.length > 0
                ? `Missing: ${health.prompts.missing.join(', ')}`
                : 'All templates found'
            }
          />
          <HealthItem
            title="AI Schemas"
            status={health.schemas.status === 'OK' ? 'success' : 'warning'}
            message={
              health.schemas.missing.length > 0
                ? `Missing: ${health.schemas.missing.join(', ')}`
                : 'All contracts valid'
            }
          />
        </div>

        <div className="mt-4">
          <a
            href={configUrl}
            className="btn btn-primary btn-block"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ClayIcon symbol="cog" className="mr-2" />
            Adjust Configuration
          </a>
        </div>
      </ClayCard.Body>
    </ClayCard>
  );
}

function HealthItem({ title, status, message }) {
  const icon =
    status === 'success'
      ? 'check-circle-full'
      : status === 'danger'
        ? 'exclamation-full'
        : 'warning-full';
  const color =
    status === 'success'
      ? 'text-success'
      : status === 'danger'
        ? 'text-danger'
        : 'text-warning';

  return (
    <div className="py-3 border-bottom d-flex align-items-start">
      <ClayIcon symbol={icon} className={`mr-3 mt-1 ${color}`} />
      <div>
        <div className="font-weight-bold" style={{ fontSize: '0.9rem' }}>
          {title}
        </div>
        <div className="small text-secondary">{message}</div>
      </div>
    </div>
  );
}

export default function AdminRoot(props) {
  return (
    <AppProvider initialConfig={props.config}>
      <AdminUI />
    </AppProvider>
  );
}
