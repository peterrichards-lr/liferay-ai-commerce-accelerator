import React, { useEffect, useMemo, useRef, useState } from 'react';
import ClayIcon from '@clayui/icon';

const MAX_LEVEL_BADGE_WIDTH = '68px';
const COPY_FEEDBACK_MS = 2000;

const LEVEL_COLORS = {
  SUCCESS: '#10B981',
  ERROR: '#EF4444',
  WARN: '#F59E0B',
  INFO: '#06B6D4',
  TRACE: '#6B7280',
  DEBUG: '#6B7280',
};

const DEFAULT_LEVEL_COLOR = '#E5E7EB';

export function levelColor(level) {
  return LEVEL_COLORS[level] || DEFAULT_LEVEL_COLOR;
}

/**
 * Entry timestamps arrive either as an ISO string from the websocket stream or
 * as an already-formatted clock time from the activity log, so accept both
 * rather than forcing one producer to change shape.
 */
export function displayTime(timestamp) {
  if (!timestamp) return 'system';
  if (typeof timestamp !== 'string') return 'system';
  if (!timestamp.includes('T')) return timestamp;

  const [, time = ''] = timestamp.split('T');
  return time.split('.')[0] || 'system';
}

export function formatEntriesForClipboard(entries) {
  return entries
    .map(
      (entry) =>
        `[${displayTime(entry.timestamp)}] [${entry.level}] ${entry.message}`
    )
    .join('\n');
}

function matchesFilter(entry, filterLevel, searchQuery) {
  const matchesLevel =
    filterLevel === 'ALL' ||
    (filterLevel === 'WARN_ERROR' &&
      (entry.level === 'WARN' || entry.level === 'ERROR')) ||
    entry.level === filterLevel;

  if (!matchesLevel) return false;
  if (!searchQuery) return true;

  const needle = searchQuery.toLowerCase();
  return (
    String(entry.message).toLowerCase().includes(needle) ||
    String(entry.level).toLowerCase().includes(needle)
  );
}

const controlStyle = {
  background: '#0F172A',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '4px',
  color: '#D1D5DB',
  outline: 'none',
  padding: '2px 8px',
};

const toolbarButtonStyle = {
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: '4px',
  color: '#9CA3AF',
  cursor: 'pointer',
  display: 'flex',
  gap: '4px',
  padding: '2px 6px',
};

function ConsolePanel({
  title,
  entries = [],
  onClear,
  clearDisabled = false,
  collapsible = false,
  defaultOpen = true,
  fillHeight = false,
  busy = false,
  busyLabel = 'Processing...',
  emptyMessage = 'No log entries to display.',
  onOpenChange,
}) {
  const [filterLevel, setFilterLevel] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isOpen, setIsOpen] = useState(collapsible ? defaultOpen : true);
  const [copied, setCopied] = useState(false);
  const scrollContainerRef = useRef(null);

  const visibleEntries = useMemo(
    () =>
      entries.filter((entry) => matchesFilter(entry, filterLevel, searchQuery)),
    [entries, filterLevel, searchQuery]
  );

  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [visibleEntries, autoScroll]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  // A collapsible consumer may defer work while collapsed - LogConsole only
  // pushes its websocket buffer into state when visible - so it has to be told
  // when the panel opens.
  const handleToggle = (next) => {
    setIsOpen(next);
    if (typeof onOpenChange === 'function') {
      onOpenChange(next);
    }
  };

  const handleCopy = async () => {
    const text = formatEntriesForClipboard(visibleEntries);
    try {
      // Absent in insecure contexts and in jsdom, where failing silently is
      // preferable to breaking the console the user is trying to read.
      await navigator?.clipboard?.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className={`aica-console d-flex flex-column${fillHeight ? ' h-100' : ''}`}
      style={{
        background: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        color: '#F3F4F6',
        fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
        fontSize: '12px',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={collapsible ? () => handleToggle(!isOpen) : undefined}
        style={{
          alignItems: 'center',
          background: 'rgba(30, 41, 59, 0.8)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          cursor: collapsible ? 'pointer' : 'default',
          display: 'flex',
          justifyContent: 'space-between',
          padding: '10px 16px',
          userSelect: 'none',
        }}
      >
        <div style={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
          <ClayIcon symbol="terminal" style={{ color: '#9CA3AF' }} />
          <span style={{ color: '#9CA3AF', fontWeight: '600' }}>{title}</span>
          {isOpen && (
            <span
              style={{
                background: '#374151',
                borderRadius: '9999px',
                color: '#9CA3AF',
                fontSize: '0.7rem',
                padding: '1px 8px',
              }}
            >
              {`${visibleEntries.length} logs`}
            </span>
          )}
        </div>

        {collapsible && (
          <ClayIcon
            symbol={isOpen ? 'angle-up' : 'angle-down'}
            style={{ color: '#9CA3AF', height: '16px', width: '16px' }}
          />
        )}
      </div>

      {isOpen && (
        <>
          <div
            style={{
              alignItems: 'center',
              background: 'rgba(30, 41, 59, 0.4)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '8px 16px',
            }}
          >
            <div style={{ alignItems: 'center', display: 'flex', gap: '6px' }}>
              <span style={{ color: '#9CA3AF' }}>Level:</span>
              <select
                aria-label="Filter by log level"
                onChange={(event) => setFilterLevel(event.target.value)}
                style={{ ...controlStyle, cursor: 'pointer' }}
                value={filterLevel}
              >
                <option value="ALL">Verbose (All)</option>
                <option value="INFO">Info</option>
                <option value="WARN">Warnings</option>
                <option value="ERROR">Errors</option>
                <option value="WARN_ERROR">Warnings &amp; Errors</option>
                <option value="SUCCESS">Success</option>
              </select>
            </div>

            <div style={{ flex: '1', minWidth: '150px' }}>
              <input
                aria-label="Search logs"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search logs..."
                style={{ ...controlStyle, width: '100%' }}
                type="text"
                value={searchQuery}
              />
            </div>

            <label
              style={{
                alignItems: 'center',
                cursor: 'pointer',
                display: 'flex',
                gap: '6px',
                margin: '0',
              }}
            >
              <input
                checked={autoScroll}
                onChange={(event) => setAutoScroll(event.target.checked)}
                style={{ accentColor: '#10B981', cursor: 'pointer' }}
                type="checkbox"
              />
              <span style={{ color: '#9CA3AF' }}>Auto-scroll</span>
            </label>

            <button
              onClick={handleCopy}
              style={toolbarButtonStyle}
              title="Copy the visible log entries to the clipboard"
              type="button"
            >
              <ClayIcon symbol={copied ? 'check' : 'paste'} />
              {copied ? 'Copied' : 'Copy'}
            </button>

            {onClear && (
              <button
                disabled={clearDisabled}
                onClick={onClear}
                style={{
                  ...toolbarButtonStyle,
                  cursor: clearDisabled ? 'not-allowed' : 'pointer',
                  opacity: clearDisabled ? 0.5 : 1,
                }}
                title="Clear console"
                type="button"
              >
                <ClayIcon symbol="trash" />
                Clear
              </button>
            )}
          </div>

          <div
            className={fillHeight ? 'flex-grow-1' : ''}
            ref={scrollContainerRef}
            style={{
              background: '#0B0F19',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              maxHeight: '400px',
              minHeight: fillHeight ? undefined : '240px',
              overflowY: 'auto',
              padding: '12px 16px',
              scrollBehavior: 'smooth',
            }}
          >
            {busy && (
              <div
                className="d-flex align-items-center mb-2"
                style={{ color: '#06B6D4' }}
              >
                <span
                  className="spinner-border spinner-border-sm mr-2"
                  role="status"
                  style={{
                    borderWidth: '0.15em',
                    height: '1rem',
                    width: '1rem',
                  }}
                ></span>
                <span style={{ fontWeight: 'bold' }}>{busyLabel}</span>
              </div>
            )}

            {visibleEntries.length === 0 && !busy ? (
              <div
                style={{
                  color: '#4B5563',
                  fontStyle: 'italic',
                  textAlign: 'center',
                  marginTop: '40px',
                }}
              >
                {emptyMessage}
              </div>
            ) : (
              visibleEntries.map((entry, index) => (
                <div
                  key={entry.id ?? index}
                  style={{
                    alignItems: 'flex-start',
                    display: 'flex',
                    gap: '8px',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <span
                    style={{
                      color: '#4B5563',
                      flexShrink: '0',
                      userSelect: 'none',
                    }}
                  >
                    [{displayTime(entry.timestamp)}]
                  </span>
                  <span
                    style={{
                      color: levelColor(entry.level),
                      flexShrink: '0',
                      fontWeight: 'bold',
                      userSelect: 'none',
                      width: MAX_LEVEL_BADGE_WIDTH,
                    }}
                  >
                    [{entry.level}]
                  </span>
                  <span style={{ color: '#E5E7EB', flex: '1' }}>
                    {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default ConsolePanel;
