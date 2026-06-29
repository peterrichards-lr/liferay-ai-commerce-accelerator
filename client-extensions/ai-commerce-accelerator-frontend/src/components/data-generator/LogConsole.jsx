import React, { useEffect, useRef, useState } from 'react';
import ClayIcon from '@clayui/icon';

function LogConsole({ logEntries = [], onClear }) {
  const [filterLevel, setFilterLevel] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isOpen, setIsOpen] = useState(true);
  const terminalEndRef = useRef(null);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logEntries, autoScroll]);

  const filteredLogs = logEntries.filter((log) => {
    const matchesLevel =
      filterLevel === 'ALL' ||
      (filterLevel === 'WARN_ERROR' &&
        (log.level === 'WARN' || log.level === 'ERROR')) ||
      log.level === filterLevel;

    const matchesSearch =
      !searchQuery ||
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.level.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesLevel && matchesSearch;
  });

  const getLogColor = (level) => {
    switch (level) {
      case 'SUCCESS':
        return '#10B981'; // vibrant green
      case 'ERROR':
        return '#EF4444'; // vibrant red
      case 'WARN':
        return '#F59E0B'; // bright amber
      case 'INFO':
        return '#06B6D4'; // cyan
      case 'TRACE':
      case 'DEBUG':
        return '#6B7280'; // gray
      default:
        return '#E5E7EB'; // cool white
    }
  };

  return (
    <div
      style={{
        marginTop: '24px',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(8px)',
        color: '#F3F4F6',
        fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
        fontSize: '12px',
        transition: 'all 0.3s ease',
      }}
    >
      {/* Header bar */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'rgba(30, 41, 59, 0.8)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Mock macOS window controls */}
          <div style={{ display: 'flex', gap: '6px' }}>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#FF5F56',
              }}
            ></span>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#FFBD2E',
              }}
            ></span>
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#27C93F',
              }}
            ></span>
          </div>
          <span
            style={{ fontWeight: '600', color: '#9CA3AF', marginLeft: '6px' }}
          >
            AICA Seeder Console log stream
          </span>
        </div>

        <div
          style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <ClayIcon
            symbol={isOpen ? 'angle-up' : 'angle-down'}
            style={{ width: '16px', height: '16px', color: '#9CA3AF' }}
          />
        </div>
      </div>

      {/* Console Content */}
      {isOpen && (
        <>
          {/* Action controls */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              padding: '8px 16px',
              background: 'rgba(30, 41, 59, 0.4)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              alignItems: 'center',
            }}
          >
            {/* Filter level */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#9CA3AF' }}>Level:</span>
              <select
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value)}
                style={{
                  background: '#0F172A',
                  color: '#D1D5DB',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="ALL">Verbose (All)</option>
                <option value="INFO">Info</option>
                <option value="WARN">Warnings</option>
                <option value="ERROR">Errors</option>
                <option value="WARN_ERROR">Warnings & Errors</option>
                <option value="SUCCESS">Success</option>
              </select>
            </div>

            {/* Search */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flex: '1',
                minWidth: '150px',
              }}
            >
              <input
                type="text"
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  background: '#0F172A',
                  color: '#D1D5DB',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  outline: 'none',
                }}
              />
            </div>

            {/* Auto scroll */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                margin: '0',
              }}
            >
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                style={{ accentColor: '#10B981', cursor: 'pointer' }}
              />
              <span style={{ color: '#9CA3AF' }}>Auto-scroll</span>
            </label>

            {/* Clear */}
            <button
              onClick={onClear}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9CA3AF',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 6px',
                borderRadius: '4px',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = 'transparent')
              }
            >
              <ClayIcon
                symbol="trash"
                style={{ width: '12px', height: '12px' }}
              />
              Clear
            </button>
          </div>

          {/* Logs Output Area */}
          <div
            style={{
              height: '240px',
              overflowY: 'auto',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              background: '#0B0F19',
              scrollBehavior: 'smooth',
            }}
          >
            {filteredLogs.length === 0 ? (
              <div
                style={{
                  color: '#4B5563',
                  fontStyle: 'italic',
                  textAlign: 'center',
                  marginTop: '80px',
                }}
              >
                No matching log entries to display. Listening to real-time
                events...
              </div>
            ) : (
              filteredLogs.map((log, idx) => {
                const time = log.timestamp
                  ? log.timestamp.split('T')[1].split('.')[0]
                  : '';
                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      lineHeight: '1.5',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {/* Timestamp */}
                    <span
                      style={{
                        color: '#4B5563',
                        flexShrink: '0',
                        userSelect: 'none',
                      }}
                    >
                      [{time || 'system'}]
                    </span>

                    {/* Level Badge */}
                    <span
                      style={{
                        color: getLogColor(log.level),
                        fontWeight: 'bold',
                        flexShrink: '0',
                        width: '65px',
                        userSelect: 'none',
                      }}
                    >
                      [{log.level}]
                    </span>

                    {/* Message */}
                    <span style={{ color: '#E5E7EB', flex: '1' }}>
                      {log.message}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={terminalEndRef} />
          </div>
        </>
      )}
    </div>
  );
}

export default LogConsole;
