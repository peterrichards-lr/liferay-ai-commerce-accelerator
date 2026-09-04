import React, { useEffect, useRef, useState } from 'react';
import ConsolePanel from '../common/ConsolePanel';

function LogConsole({ logEntries: externalEntries, onClear }) {
  const [isOpen, setIsOpen] = useState(false);
  const [renderedLogs, setRenderedLogs] = useState([]);
  const logBufferRef = useRef([]);
  const isOpenRef = useRef(false);

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (isOpen) {
      setRenderedLogs([...logBufferRef.current]);
    }
  }, [isOpen]);

  // Rendering is deferred while collapsed, so the buffer is only flushed into
  // state once ConsolePanel reports that it has been expanded.

  useEffect(() => {
    if (Array.isArray(externalEntries) && externalEntries.length > 0) {
      logBufferRef.current = externalEntries.slice(-500);
      if (isOpenRef.current) {
        setRenderedLogs([...logBufferRef.current]);
      }
    }
  }, [externalEntries]);

  useEffect(() => {
    const handleWSEvent = (event) => {
      const data = event.detail;
      if (data && data.type === 'LOG_ENTRY' && data.logEntry) {
        const next = [...logBufferRef.current, data.logEntry];
        if (next.length > 500) {
          next.splice(0, next.length - 500);
        }
        logBufferRef.current = next;

        if (isOpenRef.current) {
          setRenderedLogs([...next]);
        }
      }
    };
    window.addEventListener('liferay-ai-ws-event', handleWSEvent);
    return () => {
      window.removeEventListener('liferay-ai-ws-event', handleWSEvent);
    };
  }, []);

  const handleClear = () => {
    logBufferRef.current = [];
    setRenderedLogs([]);
    if (typeof onClear === 'function') {
      onClear();
    }
  };

  return (
    <div style={{ marginTop: '24px' }}>
      <ConsolePanel
        collapsible
        defaultOpen={false}
        emptyMessage="No matching log entries to display. Listening to real-time events..."
        entries={renderedLogs}
        onClear={handleClear}
        onOpenChange={setIsOpen}
        title="AICA Seeder Console log stream"
      />
    </div>
  );
}

export default LogConsole;
