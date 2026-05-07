import React, { useMemo } from 'react';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayCard from '@clayui/card';
import StatusBadge from './StatusBadge';

function SessionDetailModal({ session, onClose }) {
  const context = useMemo(() => {
    try {
      return typeof session.context === 'string'
        ? JSON.parse(session.context)
        : session.context;
    } catch {
      return null;
    }
  }, [session]);

  return (
    <div
      className="confirm-dialog__backdrop"
      style={{ alignItems: 'flex-start', paddingTop: '5vh' }}
    >
      <ClayCard
        style={{
          width: 'min(900px, 95%)',
          maxHeight: '85vh',
          overflow: 'hidden',
        }}
      >
        <ClayCard.Body
          className="d-flex flex-column p-0"
          style={{ height: '100%' }}
        >
          <div className="p-4 border-bottom d-flex justify-content-between align-items-center bg-light">
            <div>
              <h3 className="mb-1">
                {session.session_name || 'Session Details'}
              </h3>
              <div className="text-muted small">{session.session_id}</div>
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

            {context && (
              <>
                <div className="divider" />
                <h5 className="mb-3 font-weight-bold">Workflow Context</h5>

                <div className="mb-4">
                  <div className="small text-secondary font-weight-bold mb-2 text-uppercase">
                    Configuration & Options
                  </div>
                  <pre
                    className="p-3 bg-dark text-light rounded small"
                    style={{ maxHeight: '400px', overflow: 'auto' }}
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
                      Target Totals
                    </div>
                    <div className="d-flex flex-wrap gap-3">
                      {Object.entries(context.totals).map(([key, val]) => (
                        <div
                          key={key}
                          className="p-2 border rounded bg-white"
                          style={{ minWidth: '100px' }}
                        >
                          <div
                            className="small text-muted text-uppercase"
                            style={{ fontSize: '0.65rem' }}
                          >
                            {key}
                          </div>
                          <div className="h5 mb-0 font-weight-bold">{val}</div>
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
              Close
            </ClayButton>
          </div>
        </ClayCard.Body>
      </ClayCard>
    </div>
  );
}

export default SessionDetailModal;
