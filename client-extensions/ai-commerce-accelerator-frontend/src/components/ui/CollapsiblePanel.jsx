import React, { useEffect, useMemo, useState } from 'react';

function CollapsiblePanel({
  id,
  title,
  headerActions = null,
  children,
  startOpen = true,
  autoCollapseWhen = false,
  expandSignal = null,
  collapsedIndicator = '⏵',
  expandedIndicator = '⏷',
  className = '',
}) {
  const [open, setOpen] = useState(Boolean(startOpen));

  const panelId = useMemo(
    () =>
      id ||
      `panel-${String(title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')}`,
    [id, title]
  );

  useEffect(() => {
    if (autoCollapseWhen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
    }
  }, [autoCollapseWhen]);

  useEffect(() => {
    if (expandSignal !== null && expandSignal !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [expandSignal]);

  const toggle = () => setOpen((v) => !v);

  return (
    <div className={`form-card ${className}`}>
      <div
        className="form-header d-flex align-items-center justify-content-between"
        role="button"
        aria-expanded={open}
        aria-controls={`${panelId}-body`}
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        style={{ cursor: 'pointer' }}
      >
        <div className="d-flex align-items-center">
          <span className="mr-2" aria-hidden="true">
            {open ? expandedIndicator : collapsedIndicator}
          </span>
          <span className="h5 mb-0 d-flex align-items-center">{title}</span>
        </div>
        {headerActions && (
          <div
            className="form-header-actions"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {headerActions}
          </div>
        )}
      </div>
      {open && (
        <div id={`${panelId}-body`} className="form-body">
          {children}
        </div>
      )}
    </div>
  );
}

export default CollapsiblePanel;
