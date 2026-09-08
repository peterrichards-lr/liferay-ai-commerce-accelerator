import React, { useState, useEffect, useCallback } from 'react';
import ClayModal, { useModal } from '@clayui/modal';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';
import ClayTable from '@clayui/table';
import notifyUser from '../../utils/notifications';
import { COMPLETED_WORKFLOW_SESSIONS } from '../../utils/microservicePaths';

const SCOPES = {
  MISSING: 'missing',
  ALL: 'all',
};

const countFor = (session, scope) => {
  if (!session) return { images: 0, pdfs: 0 };
  if (scope === SCOPES.ALL) {
    return {
      images: session.counts?.products || 0,
      pdfs: session.counts?.products || 0,
    };
  }
  return {
    images: session.media?.missingImages || 0,
    pdfs: session.media?.missingPdfs || 0,
  };
};

/**
 * Mounted only while open, so each opening starts from a clean selection
 * without an effect having to reset one.
 */
function MediaGenerationDialog({ onClose, onGenerate, api, submitting }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [scope, setScope] = useState(SCOPES.MISSING);
  const { observer, onClose: handleClose } = useModal({ onClose });

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
    if (api) {
      Promise.resolve().then(() => loadSessions());
    }
  }, [api, loadSessions]);

  const selected = sessions.find((s) => s.id === selectedId) || null;
  const { images, pdfs } = countFor(selected, scope);
  const nothingToDo = images === 0 && pdfs === 0;

  const handleGenerate = async () => {
    await onGenerate({ sourceSessionId: selectedId, scope });
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
    <ClayModal observer={observer} size="lg">
      <ClayModal.Header>Generate Images and Attachments</ClayModal.Header>
      <ClayModal.Body>
        <p className="text-secondary mb-4">
          Attach images and PDFs to products that already exist in Liferay,
          matched by external reference code. Nothing else is recreated - no
          products, SKUs, pricing or orders. Use this for a dataset imported
          from another instance, which never carries its media, or for a run
          whose media failed.
        </p>

        {loading ? (
          <div className="text-center p-5">
            <span className="spinner-border text-primary" role="status"></span>
            <p className="mt-2 text-muted">Loading sessions...</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center p-5 border rounded bg-light">
            <ClayIcon
              symbol="info-circle"
              className="display-4 text-muted mb-3"
            />
            <p>No completed sessions found.</p>
          </div>
        ) : (
          <>
            <div className="table-responsive" style={{ maxHeight: '320px' }}>
              <ClayTable>
                <ClayTable.Head>
                  <ClayTable.Row>
                    <ClayTable.Cell headingCell>
                      Session Name / ID
                    </ClayTable.Cell>
                    <ClayTable.Cell headingCell>Date</ClayTable.Cell>
                    <ClayTable.Cell headingCell>Products</ClayTable.Cell>
                    <ClayTable.Cell headingCell>Missing media</ClayTable.Cell>
                    <ClayTable.Cell headingCell />
                  </ClayTable.Row>
                </ClayTable.Head>
                <ClayTable.Body>
                  {sessions.map((s) => (
                    <ClayTable.Row
                      key={s.id}
                      active={s.id === selectedId}
                      onClick={() => setSelectedId(s.id)}
                    >
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
                        {s.counts?.products || 0}
                      </ClayTable.Cell>
                      <ClayTable.Cell style={{ fontSize: '0.875rem' }}>
                        <div
                          className="d-flex flex-wrap"
                          style={{ gap: '0.25rem' }}
                        >
                          <span className="badge badge-info">
                            {s.media?.missingImages || 0} img
                          </span>
                          <span className="badge badge-info">
                            {s.media?.missingPdfs || 0} pdf
                          </span>
                        </div>
                      </ClayTable.Cell>
                      <ClayTable.Cell className="text-right">
                        <ClayButton
                          displayType={
                            s.id === selectedId ? 'primary' : 'secondary'
                          }
                          size="sm"
                          onClick={() => setSelectedId(s.id)}
                        >
                          {s.id === selectedId ? 'Selected' : 'Select'}
                        </ClayButton>
                      </ClayTable.Cell>
                    </ClayTable.Row>
                  ))}
                </ClayTable.Body>
              </ClayTable>
            </div>

            <fieldset className="mt-4">
              <legend className="text-secondary small font-weight-bold">
                Which products
              </legend>
              <div className="custom-control custom-radio mb-1">
                <input
                  type="radio"
                  id="mediaScopeMissing"
                  className="custom-control-input"
                  checked={scope === SCOPES.MISSING}
                  onChange={() => setScope(SCOPES.MISSING)}
                />
                <label
                  className="custom-control-label"
                  htmlFor="mediaScopeMissing"
                >
                  Only products missing media
                </label>
              </div>
              <div className="custom-control custom-radio">
                <input
                  type="radio"
                  id="mediaScopeAll"
                  className="custom-control-input"
                  checked={scope === SCOPES.ALL}
                  onChange={() => setScope(SCOPES.ALL)}
                />
                <label className="custom-control-label" htmlFor="mediaScopeAll">
                  Every product (adds a second image to products that already
                  have one)
                </label>
              </div>
            </fieldset>

            {selected && (
              <div className="alert alert-warning mt-4 mb-0" role="alert">
                This will generate <strong>{images}</strong> image(s) and{' '}
                <strong>{pdfs}</strong> PDF(s) using your current media
                settings. Media is the most expensive part of a run and the cost
                is yours.
              </div>
            )}
          </>
        )}
      </ClayModal.Body>
      <ClayModal.Footer
        last={
          <ClayButton.Group spaced>
            <ClayButton displayType="secondary" onClick={handleClose}>
              Cancel
            </ClayButton>
            <ClayButton
              displayType="primary"
              disabled={!selected || nothingToDo || submitting}
              onClick={handleGenerate}
            >
              <ClayIcon symbol="picture" className="mr-1" />
              Generate Media
            </ClayButton>
          </ClayButton.Group>
        }
      />
    </ClayModal>
  );
}

export default function MediaGenerationModal({ visible, ...props }) {
  if (!visible) return null;

  return <MediaGenerationDialog {...props} />;
}
