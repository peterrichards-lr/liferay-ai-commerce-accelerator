import React, { useMemo, useState, useEffect } from 'react';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayCard from '@clayui/card';
import { useApi } from '../../context/AppContext';
import { WORKFLOW_EVENTS, LOGS_SESSION } from '../../utils/microservicePaths';
import StatusBadge from './StatusBadge';

function SessionDetailModal({ session, onClose }) {
  const api = useApi();
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [downloadingLogs, setDownloadingLogs] = useState(false);
  const [showStack, setShowStack] = useState(false);

  const context = useMemo(() => {
    try {
      return typeof session.context === 'string'
        ? JSON.parse(session.context)
        : session.context;
    } catch {
      return null;
    }
  }, [session]);

  useEffect(() => {
    async function fetchEvents() {
      setLoadingEvents(true);
      try {
        const url = WORKFLOW_EVENTS.replace(':sessionId', session.session_id);
        const res = await api.get(url);
        if (res?.success) {
          setEvents(res.events || []);
        }
      } catch (err) {
        console.error('Failed to fetch session events:', err);
      } finally {
        setLoadingEvents(false);
      }
    }

    if (session.session_id) {
      fetchEvents();
    }
  }, [api, session.session_id]);

  const handleDownloadSessionLogs = async () => {
    setDownloadingLogs(true);
    try {
      const url = LOGS_SESSION.replace(':sessionId', session.session_id);
      const res = await api.get(url, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([res]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `session-${session.session_id}.log`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Failed to download session logs:', err);
    } finally {
      setDownloadingLogs(false);
    }
  };

  const copyToClipboard = (text, type = 'Context') => {
    navigator.clipboard.writeText(text);
    // Minimal feedback via button state could be added, but for now we rely on the system
    console.log(`${type} copied to clipboard`);
  };

  return (
    <div
      className="confirm-dialog__backdrop"
      style={{ alignItems: 'flex-start', paddingTop: '5vh', zIndex: 1050 }}
    >
      <ClayCard
        style={{
          width: 'min(1000px, 95%)',
          maxHeight: '90vh',
          overflow: 'hidden',
        }}
      >
        <ClayCard.Body
          className="d-flex flex-column p-0"
          style={{ height: '100%' }}
        >
          <div className="p-4 border-bottom d-flex justify-content-between align-items-center bg-light">
            <div className="d-flex align-items-center">
              <div>
                <h3 className="mb-1">
                  {session.session_name || 'Session Details'}
                </h3>
                <div className="d-flex align-items-center text-muted small">
                  {session.session_id}
                  <ClayButton
                    displayType="unstyled"
                    size="sm"
                    className="ml-2 p-0"
                    onClick={() =>
                      copyToClipboard(session.session_id, 'Session ID')
                    }
                    title="Copy Session ID"
                  >
                    <ClayIcon
                      symbol="copy"
                      style={{ width: '12px', height: '12px' }}
                    />
                  </ClayButton>
                </div>
              </div>
              <ClayButton
                displayType="secondary"
                size="sm"
                className="ml-4"
                onClick={handleDownloadSessionLogs}
                disabled={downloadingLogs}
              >
                {downloadingLogs ? (
                  <span className="spinner-border spinner-border-sm mr-2" />
                ) : (
                  <ClayIcon symbol="download" className="mr-2" />
                )}
                Download Session Logs
              </ClayButton>
            </div>
            <ClayButton
              displayType="unstyled"
              onClick={onClose}
              aria-label="Close"
            >
              <ClayIcon
                symbol="times"
                style={{ width: '20px', height: '20px' }}
              />
            </ClayButton>
          </div>

          <div
            className="p-4 overflow-auto flex-fill"
            style={{ backgroundColor: '#fdfdfd' }}
          >
            <div className="row mb-4">
              <div className="col-md-4">
                <div className="small text-secondary font-weight-bold mb-1 text-uppercase">
                  STATUS
                </div>
                <StatusBadge status={session.status} />
              </div>
              <div className="col-md-4">
                <div className="small text-secondary font-weight-bold mb-1 text-uppercase">
                  FLOW TYPE
                </div>
                <div className="font-weight-semi-bold">{session.flow_type}</div>
              </div>
              <div className="col-md-4">
                <div className="small text-secondary font-weight-bold mb-1 text-uppercase">
                  STARTED
                </div>
                <div className="font-weight-semi-bold">
                  {new Date(session.created_at).toLocaleString()}
                </div>
              </div>
            </div>

            {session.status === 'FAILED' && session.error_message && (
              <div className="alert alert-danger mb-4 border-0 shadow-sm">
                <div className="d-flex">
                  <ClayIcon symbol="exclamation-full" className="mr-3 mt-1" />
                  <div>
                    <div className="font-weight-bold mb-1">Terminal Error</div>
                    <div style={{ wordBreak: 'break-word' }}>
                      {session.error_message}
                    </div>
                    {session.errorReferenceCode && (
                      <div className="mt-2 small opacity-70">
                        <strong>Error Reference:</strong>{' '}
                        {session.errorReferenceCode}
                      </div>
                    )}
                    {session.correlationId && (
                      <div className="small opacity-70">
                        <strong>Correlation ID:</strong> {session.correlationId}
                      </div>
                    )}
                    {session.error_stack && (
                      <div className="mt-3">
                        <ClayButton
                          displayType="unstyled"
                          size="sm"
                          className="p-0 text-danger font-weight-bold"
                          onClick={() => setShowStack(!showStack)}
                        >
                          <ClayIcon
                            symbol={showStack ? 'caret-bottom' : 'caret-right'}
                            className="mr-1"
                          />
                          {showStack ? 'Hide' : 'View'} Stack Trace
                        </ClayButton>
                        {showStack && (
                          <pre
                            className="mt-2 p-3 bg-dark text-light rounded small border-0 shadow-sm"
                            style={{
                              maxHeight: '300px',
                              overflow: 'auto',
                              fontSize: '0.75rem',
                              whiteSpace: 'pre-wrap',
                              fontFamily: 'monospace',
                              borderLeft: '4px solid #da1010',
                            }}
                          >
                            {session.error_stack}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* EVENT LOG / AUDIT TRAIL */}
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h5 className="mb-0 font-weight-bold d-flex align-items-center">
                <ClayIcon symbol="list" className="mr-2 text-primary" />
                Audit Trail
                {loadingEvents && (
                  <span className="spinner-border spinner-border-sm ml-2" />
                )}
              </h5>
              <div className="d-flex align-items-center">
                {session.correlationId && (
                  <span className="small text-muted mr-3">
                    CID: {session.correlationId}
                  </span>
                )}
                <ClayButton
                  displayType="secondary"
                  size="sm"
                  onClick={() => {
                    const text = events
                      .map(
                        (e) =>
                          `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.status}: ${e.message}`
                      )
                      .join('\n');
                    copyToClipboard(text, 'Audit Trail');
                  }}
                  disabled={events.length === 0}
                >
                  <ClayIcon symbol="copy" className="mr-2" />
                  Copy Audit Trail
                </ClayButton>
              </div>
            </div>

            <div
              className="mb-4 border rounded bg-white shadow-sm"
              style={{ maxHeight: '300px', overflow: 'auto' }}
            >
              <table className="table table-sm mb-0 table-hover">
                <thead className="bg-light sticky-top">
                  <tr>
                    <th
                      className="border-top-0 pl-3"
                      style={{ width: '120px' }}
                    >
                      Time
                    </th>
                    <th className="border-top-0" style={{ width: '150px' }}>
                      Status
                    </th>
                    <th className="border-top-0">Event / Message</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 ? (
                    <tr>
                      <td colSpan="3" className="text-center py-4 text-muted">
                        {loadingEvents ? 'Loading logs...' : 'No events found.'}
                      </td>
                    </tr>
                  ) : (
                    events.map((event) => {
                      const isError =
                        event.status.includes('FAILED') ||
                        event.status === 'ERROR';
                      return (
                        <tr key={event.id}>
                          <td className="pl-3 small text-muted">
                            {new Date(event.timestamp).toLocaleTimeString()}
                          </td>
                          <td>
                            <span
                              className={`badge badge-${isError ? 'danger' : 'light'} font-weight-bold text-uppercase`}
                              style={{ fontSize: '0.65rem' }}
                            >
                              {event.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="small">
                            <div className="font-weight-semi-bold">
                              {event.message}
                            </div>
                            {event.details?.firstError && (
                              <div className="text-danger mt-1">
                                <strong>Detail:</strong>{' '}
                                {event.details.firstError}
                              </div>
                            )}
                            {event.details?.error && (
                              <div className="text-danger mt-1">
                                {typeof event.details.error === 'string'
                                  ? event.details.error
                                  : event.details.error.message}
                              </div>
                            )}
                            {event.details?.failedItems && (
                              <div className="mt-2">
                                <div
                                  className="text-muted mb-1"
                                  style={{ fontSize: '0.7rem' }}
                                >
                                  <strong>Liferay Error Report:</strong>
                                </div>
                                <div
                                  className="p-2 bg-light border rounded"
                                  style={{
                                    maxHeight: '150px',
                                    overflow: 'auto',
                                  }}
                                >
                                  {event.details.failedItems.map(
                                    (item, idx) => (
                                      <div
                                        key={idx}
                                        className="mb-2 pb-2 border-bottom last-child-no-border"
                                        style={{ fontSize: '0.75rem' }}
                                      >
                                        <div className="text-danger font-weight-bold">
                                          {item.errorMessage ||
                                            item.error ||
                                            'Unknown error'}
                                        </div>
                                        {item.externalReferenceCode && (
                                          <div className="text-muted">
                                            ERC: {item.externalReferenceCode}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {context && (
              <>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="mb-0 font-weight-bold d-flex align-items-center">
                    <ClayIcon symbol="info-circle" className="mr-2 text-info" />
                    Workflow Configuration
                  </h5>
                  <ClayButton
                    displayType="secondary"
                    size="sm"
                    onClick={() => {
                      const clean = {
                        options: context.options,
                        config: {
                          ...context.config,
                          clientSecret: '[REDACTED]',
                        },
                        steps: context.steps,
                      };
                      copyToClipboard(
                        JSON.stringify(clean, null, 2),
                        'Configuration'
                      );
                    }}
                  >
                    <ClayIcon symbol="copy" className="mr-2" />
                    Copy JSON
                  </ClayButton>
                </div>

                <div className="mb-4">
                  <pre
                    className="p-3 bg-dark text-light rounded small border-0 shadow-sm"
                    style={{ maxHeight: '300px', overflow: 'auto' }}
                  >
                    {JSON.stringify(
                      {
                        options: context.options,
                        config: {
                          ...context.config,
                          clientSecret: '[REDACTED]',
                        },
                        steps: context.steps,
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>

                {context.totals && (
                  <div>
                    <div className="small text-secondary font-weight-bold mb-2 text-uppercase">
                      Generated Quantities
                    </div>
                    <div className="d-flex flex-wrap gap-3">
                      {Object.entries(context.totals).map(([key, val]) => (
                        <div
                          key={key}
                          className="p-2 border rounded bg-white shadow-sm"
                          style={{ minWidth: '100px' }}
                        >
                          <div
                            className="small text-muted text-uppercase"
                            style={{ fontSize: '0.65rem' }}
                          >
                            {key}
                          </div>
                          <div className="h5 mb-0 font-weight-bold text-primary">
                            {val}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="p-4 border-top bg-light text-right">
            <ClayButton displayType="secondary" onClick={onClose}>
              Close Details
            </ClayButton>
          </div>
        </ClayCard.Body>
      </ClayCard>
    </div>
  );
}

export default SessionDetailModal;
