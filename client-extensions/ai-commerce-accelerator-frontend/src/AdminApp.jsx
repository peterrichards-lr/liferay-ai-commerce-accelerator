import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ClayLayout from '@clayui/layout';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayTable from '@clayui/table';
import ClayCard from '@clayui/card';
import ClayLabel from '@clayui/label';
import { useApp, useApi, AppProvider } from './context/AppContext';
import { ConfirmProvider, useConfirm } from './components/ConfirmProvider';
import notifyUser from './utils/notifications';
import { buildFilename, exportJsonFile } from './utils/fileHelper';
import {
  WORKFLOW_SESSIONS,
  WORKFLOW_KPIS,
  CONFIG_HEALTH,
  HEALTH,
  EXPORT_COMMERCE_DATA,
  WORKFLOW_CLEAR_ALL,
} from './utils/microservicePaths';

const formatUptime = (seconds) => {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${d}d ${h}h ${m}m ${s}s`.replace(/^(0d\s|0h\s|0m\s)*/, '');
};

function AdminUI() {
  const { config } = useApp();
  const api = useApi();
  const confirm = useConfirm();

  const [sessions, setSessions] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [health, setHealth] = useState(null);
  const [systemInfo, setSystemInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [connectionEstablished, setConnectionEstablished] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [sortConfig, setSortConfig] = useState({
    key: 'created_at',
    direction: 'desc',
  });
  const [filters, setSortFilters] = useState({ name: '', status: '' });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setConnectionError(null);
    try {
      const [sessionsRes, kpisRes, healthRes, systemRes] = await Promise.all([
        api.get(WORKFLOW_SESSIONS),
        api.get(WORKFLOW_KPIS),
        api.get(CONFIG_HEALTH),
        api.get(HEALTH),
      ]);

      if (sessionsRes?.success) setSessions(sessionsRes.sessions || []);
      if (kpisRes?.success) setKpis(kpisRes.kpis);
      if (healthRes?.success) setHealth(healthRes.health);
      if (systemRes?.service) setSystemInfo(systemRes);

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

  const handlePurgeHistory = async () => {
    const ok = await confirm({
      title: 'Purge Workflow History?',
      message:
        'This will permanently delete all historic sessions, events, and logs from the database. This action cannot be undone.',
      confirmText: 'Purge All Data',
      destructive: true,
    });

    if (!ok) return;

    setPurging(true);
    try {
      await api.del(WORKFLOW_CLEAR_ALL);
      notifyUser('History purged successfully');
      fetchData();
    } catch (err) {
      console.error('Failed to purge history:', err);
      notifyUser('Failed to purge history', 'danger');
    } finally {
      setPurging(false);
    }
  };

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

  // Pagination logic
  const totalPages = Math.ceil(filteredSessions.length / pageSize);
  const paginatedSessions = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSessions.slice(start, start + pageSize);
  }, [filteredSessions, currentPage, pageSize]);

  useEffect(() => {
    // Reset to first page when filters change
    Promise.resolve().then(() => setCurrentPage(1));
  }, [filters, pageSize]);

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
      <header className="mb-4 d-flex justify-content-between align-items-center">
        <div>
          <h1 className="h3 font-weight-bold mb-1">System Administration</h1>
          <p className="text-secondary mb-0">
            Monitor system health and explore historic generation sessions
          </p>
        </div>
        <div className="d-flex gap-2">
          <ClayButton
            displayType="secondary"
            onClick={handlePurgeHistory}
            disabled={loading || purging || sessions.length === 0}
          >
            {purging ? (
              <span
                className="spinner-border spinner-border-sm mr-2"
                role="status"
              />
            ) : (
              <ClayIcon symbol="trash" className="mr-2" />
            )}
            Purge History
          </ClayButton>
          <ClayButton
            displayType="primary"
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
            Refresh
          </ClayButton>
        </div>
      </header>

      <ClayLayout.Row>
        <ClayLayout.Col lg={3} md={6}>
          <KPICard
            title="Total Sessions"
            value={kpis?.totalSessions || 0}
            icon="list"
            color="text-primary"
          />
        </ClayLayout.Col>
        <ClayLayout.Col lg={3} md={6}>
          <KPICard
            title="Success Rate"
            value={`${Math.round(kpis?.successRate || 0)}%`}
            icon="check-circle"
            color="text-success"
          />
        </ClayLayout.Col>
        <ClayLayout.Col lg={3} md={6}>
          <KPICard
            title="Failed Sessions"
            value={kpis?.failedSessions || 0}
            icon="exclamation-circle"
            color="text-danger"
          />
        </ClayLayout.Col>
        <ClayLayout.Col lg={3} md={6}>
          <KPICard
            title="Cancelled"
            value={kpis?.cancelledSessions || 0}
            icon="hr"
            color="text-warning"
          />
        </ClayLayout.Col>
      </ClayLayout.Row>

      {systemInfo && (
        <ClayLayout.Row className="mb-4">
          <ClayLayout.Col lg={3} md={6}>
            <div className="small text-secondary font-weight-bold mb-1">
              UPTIME
            </div>
            <div className="font-weight-semi-bold">
              {formatUptime(systemInfo.uptime)}
            </div>
          </ClayLayout.Col>
          <ClayLayout.Col lg={3} md={6}>
            <div className="small text-secondary font-weight-bold mb-1">
              MEMORY
            </div>
            <div className="font-weight-semi-bold">
              {systemInfo.memory.used}MB / {systemInfo.memory.total}MB
            </div>
          </ClayLayout.Col>
          <ClayLayout.Col lg={3} md={6}>
            <div className="small text-secondary font-weight-bold mb-1">
              PLATFORM
            </div>
            <div className="font-weight-semi-bold">
              {systemInfo.node.platform} ({systemInfo.node.arch})
            </div>
          </ClayLayout.Col>
          <ClayLayout.Col lg={3} md={6}>
            <div className="small text-secondary font-weight-bold mb-1">
              ENVIRONMENT
            </div>
            <div className="font-weight-semi-bold text-uppercase">
              {systemInfo.environment || 'production'}
            </div>
          </ClayLayout.Col>
        </ClayLayout.Row>
      )}

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
                <div className="d-flex gap-2 align-items-center">
                  <div className="d-flex align-items-center mr-3">
                    <span className="small text-secondary mr-2">Show:</span>
                    <select
                      className="form-control form-control-sm"
                      style={{ width: '70px' }}
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                    >
                      <option value="10">10</option>
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    placeholder="Filter by name..."
                    style={{ width: '180px' }}
                    value={filters.name}
                    onChange={(e) =>
                      setSortFilters((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                  <select
                    className="form-control form-control-sm"
                    style={{ width: '130px' }}
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
                    {paginatedSessions.length === 0 ? (
                      <ClayTable.Row>
                        <ClayTable.Cell
                          colSpan={4}
                          className="text-center py-5"
                        >
                          <div className="text-secondary">
                            No sessions found.
                          </div>
                        </ClayTable.Cell>
                      </ClayTable.Row>
                    ) : (
                      paginatedSessions.map((s) => (
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
                              title="Export dataset"
                            >
                              <ClayIcon symbol="download" className="mr-1" />
                            </ClayButton>
                          </ClayTable.Cell>
                        </ClayTable.Row>
                      ))
                    )}
                  </ClayTable.Body>
                </ClayTable>
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="d-flex justify-content-between align-items-center mt-3">
                  <div className="small text-secondary">
                    Showing {paginatedSessions.length} of{' '}
                    {filteredSessions.length} sessions
                  </div>
                  <div className="btn-group">
                    <ClayButton
                      displayType="secondary"
                      size="sm"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => p - 1)}
                    >
                      <ClayIcon symbol="angle-left" />
                    </ClayButton>
                    <div className="btn btn-sm btn-secondary disabled bg-light">
                      Page {currentPage} of {totalPages}
                    </div>
                    <ClayButton
                      displayType="secondary"
                      size="sm"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage((p) => p + 1)}
                    >
                      <ClayIcon symbol="angle-right" />
                    </ClayButton>
                  </div>
                </div>
              )}
            </ClayCard.Body>
          </ClayCard>
        </ClayLayout.Col>
      </ClayLayout.Row>
    </div>
  );
}

function KPICard({ title, value, icon, color }) {
  return (
    <ClayCard className="mb-4 shadow-sm border-0">
      <ClayCard.Body className="p-4">
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <div
              className="text-secondary small font-weight-bold mb-1"
              style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}
            >
              {title}
            </div>
            <div className={`h2 font-weight-bold mb-0 ${color}`}>{value}</div>
          </div>
          <div
            className="p-3 rounded-circle bg-light d-flex align-items-center justify-content-center"
            style={{ width: '50px', height: '50px' }}
          >
            <ClayIcon symbol={icon} className={color} />
          </div>
        </div>
      </ClayCard.Body>
    </ClayCard>
  );
}

function StatusBadge({ status }) {
  let displayType = 'secondary';
  if (status === 'COMPLETED') displayType = 'success';
  if (status === 'FAILED') displayType = 'danger';
  if (status === 'CANCELLED') displayType = 'warning';
  if (status === 'STARTED' || status === 'PROCESSING') displayType = 'info';

  return (
    <ClayLabel displayType={displayType} outline>
      {status}
    </ClayLabel>
  );
}

function ConfigurationDoctor({ health, liferayUrl }) {
  if (!health) return null;

  const configUrl = `${liferayUrl}/group/guest/~/control_panel/manage?p_p_id=com_liferay_client_extension_web_internal_portlet_ClientExtensionEntryPortlet_30394841094851_LXC_liferay_ai_commerce_accelerator_configuration&p_p_lifecycle=0&p_p_state=maximized#ai-config`;

  return (
    <ClayCard>
      <ClayCard.Body>
        <h4 className="mb-4">Configuration Doctor</h4>

        <div className="health-list">
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
              health.aiMedia.status === 'CONFIGURED' ||
              health.aiMedia.status === 'INHERITED'
                ? 'success'
                : 'danger'
            }
            message={
              health.aiMedia.status === 'INHERITED'
                ? `Inheriting from Core AI (${health.aiText.provider})`
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
        <div
          className="small text-secondary text-truncate"
          style={{ maxWidth: '220px' }}
          title={message}
        >
          {message}
        </div>
      </div>
    </div>
  );
}

function AdminRootWithContext(props) {
  return (
    <AppProvider initialConfig={props.config}>
      <ConfirmProvider>
        <AdminUI />
      </ConfirmProvider>
    </AppProvider>
  );
}

export default AdminRootWithContext;
