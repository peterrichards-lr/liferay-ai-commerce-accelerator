import React, { useState, useEffect, useCallback } from 'react';
import ClayModal, { useModal } from '@clayui/modal';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayTable from '@clayui/table';
import notifyUser from '../../utils/notifications';
import { COMPLETED_WORKFLOW_SESSIONS } from '../../utils/microservicePaths';

export default function SessionSelectorModal({
  visible,
  onClose,
  onSelect,
  api,
}) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const { observer, onClose: handleClose } = useModal({
    onClose,
  });

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(COMPLETED_WORKFLOW_SESSIONS);
      if (res?.success) {
        setSessions(res.sessions || []);
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
      notifyUser('Failed to load completed sessions', 'danger');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (visible && api) {
      Promise.resolve().then(() => loadSessions());
    }
  }, [visible, api, loadSessions]);

  const handleSelect = (session) => {
    onSelect(session);
    handleClose();
  };

  const formatDate = (dateStr) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <>
      {visible && (
        <ClayModal observer={observer} size="lg">
          <ClayModal.Header>Export AI Dataset</ClayModal.Header>
          <ClayModal.Body>
            <p className="text-secondary mb-4">
              Select a successful generation run to export its dataset. This
              allows you to re-populate another environment with the exact same
              data.
            </p>

            {loading ? (
              <div className="text-center p-5">
                <span
                  className="spinner-border text-primary"
                  role="status"
                ></span>
                <p className="mt-2 text-muted">Loading sessions...</p>
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center p-5 border rounded bg-light">
                <ClayIcon
                  symbol="info-circle"
                  className="display-4 text-muted mb-3"
                />
                <p>No successful generation runs found.</p>
              </div>
            ) : (
              <div className="table-responsive" style={{ maxHeight: '400px' }}>
                <ClayTable>
                  <ClayTable.Head>
                    <ClayTable.Row>
                      <ClayTable.Cell headingCell>
                        Session Name / ID
                      </ClayTable.Cell>
                      <ClayTable.Cell headingCell>Date</ClayTable.Cell>
                      <ClayTable.Cell headingCell>Items</ClayTable.Cell>
                      <ClayTable.Cell headingCell />
                    </ClayTable.Row>
                  </ClayTable.Head>
                  <ClayTable.Body>
                    {sessions.map((s) => (
                      <ClayTable.Row key={s.id}>
                        <ClayTable.Cell>
                          <div className="font-weight-bold">
                            {s.name || 'Unnamed Session'}
                          </div>
                          <small className="text-muted">{s.id}</small>
                        </ClayTable.Cell>
                        <ClayTable.Cell style={{ fontSize: '0.875rem' }}>
                          {formatDate(s.date)}
                        </ClayTable.Cell>
                        <ClayTable.Cell style={{ fontSize: '0.875rem' }}>
                          <div
                            className="d-flex flex-wrap"
                            style={{ gap: '0.25rem' }}
                          >
                            {s.counts.products > 0 && (
                              <span className="badge badge-info">
                                {s.counts.products} P
                              </span>
                            )}
                            {s.counts.accounts > 0 && (
                              <span className="badge badge-info">
                                {s.counts.accounts} A
                              </span>
                            )}
                            {s.counts.orders > 0 && (
                              <span className="badge badge-info">
                                {s.counts.orders} O
                              </span>
                            )}
                          </div>
                        </ClayTable.Cell>
                        <ClayTable.Cell className="text-right">
                          <ClayButton
                            displayType="primary"
                            size="sm"
                            onClick={() => handleSelect(s)}
                            title="Export this dataset"
                          >
                            <ClayIcon symbol="download" className="mr-1" />
                            Export
                          </ClayButton>
                        </ClayTable.Cell>
                      </ClayTable.Row>
                    ))}
                  </ClayTable.Body>
                </ClayTable>
              </div>
            )}
          </ClayModal.Body>
          <ClayModal.Footer
            last={
              <ClayButton displayType="secondary" onClick={handleClose}>
                Cancel
              </ClayButton>
            }
          />
        </ClayModal>
      )}
    </>
  );
}
