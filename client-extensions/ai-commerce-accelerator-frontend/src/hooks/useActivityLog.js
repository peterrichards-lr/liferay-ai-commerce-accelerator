import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export default function useActivityLog({
  level = 'info',
  maxEntries = 500,
  dedupeWindowMs = 1000,
  mirrorToConsole = true,
  storageKey = 'activityLog:v1', // change if you want a distinct key
  hydrateOnMount = true,
} = {}) {
  const [logs, setLogs] = useState(() => {
    if (!hydrateOnMount || typeof window === 'undefined') return [];
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.slice(0, maxEntries);
        }
      }
    } catch {
      /* ignore */
    }
    return [];
  });

  const levelRank = useMemo(
    () =>
      ({
        off: 99,
        error: 0,
        warn: 1,
        warning: 1,
        info: 2,
        success: 2,
        debug: 3,
      })[level] ?? 2,
    [level]
  );
  const lastRef = useRef({ msg: null, type: null, source: null, at: 0 });

  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify(logs.slice(0, maxEntries))
      );
    } catch {
      /* ignore storage errors */
    }
  }, [logs, maxEntries, storageKey]);

  const shouldLog = useCallback(
    (type) => {
      const rank =
        { error: 0, warn: 1, warning: 1, info: 2, success: 2, debug: 3 }[
          type
        ] ?? 2;
      return rank <= levelRank;
    },
    [levelRank]
  );

  const mirror = useCallback(
    (entry) => {
      if (!mirrorToConsole) return;
      const tag = entry.source ? `[${entry.source}] ` : '';
      const line = `[${entry.timestamp}] ${entry.type.toUpperCase()}: ${tag}${
        entry.message
      }`;
      if (entry.type === 'error') console.error(line);
      else if (entry.type === 'warn' || entry.type === 'warning')
        console.warn(line);
      else if (entry.type === 'debug') console.debug(line);
      else console.log(line);
    },
    [mirrorToConsole]
  );

  const makeEntry = useCallback(
    (message, type = 'info', source) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      message,
      type,
      source: source || undefined,
    }),
    []
  );

  const addLog = useCallback(
    (message, type = 'info', source) => {
      if (!shouldLog(type)) return;

      const now = Date.now();
      const isDupe =
        lastRef.current.msg === message &&
        lastRef.current.type === type &&
        lastRef.current.source === source &&
        now - lastRef.current.at < dedupeWindowMs;

      if (isDupe) return;

      lastRef.current = { msg: message, type, source, at: now };
      const entry = makeEntry(message, type, source);

      setLogs((prev) => [entry, ...prev].slice(0, maxEntries));
      mirror(entry);
    },
    [dedupeWindowMs, makeEntry, maxEntries, mirror, shouldLog]
  );

  const addLogGroup = useCallback(
    (title, items, sourceForTitle) => {
      if (!items || !Array.isArray(items) || items.length === 0) return;

      const header = makeEntry(title, 'info', sourceForTitle);
      const entries = [header];

      for (const it of items) {
        const obj =
          typeof it === 'string' ? { message: it, type: 'info' } : it || {};
        const e = makeEntry(obj.message ?? '', obj.type ?? 'info', obj.source);
        entries.push(e);
      }

      // De-dupe only for the header vs immediate previous entry
      const now = Date.now();
      const wouldDupeHeader =
        lastRef.current.msg === header.message &&
        lastRef.current.type === header.type &&
        lastRef.current.source === header.source &&
        now - lastRef.current.at < dedupeWindowMs;

      setLogs((prev) => {
        const base = wouldDupeHeader ? prev : [header, ...prev];
        const withItems = [...entries.slice(1), ...base];
        return withItems.slice(0, maxEntries);
      });

      // Update lastRef so immediate repeated groups get deduped
      lastRef.current = {
        msg: header.message,
        type: header.type,
        source: header.source,
        at: now,
      };

      // Mirror all
      [header, ...entries.slice(1)].forEach(mirror);
    },
    [dedupeWindowMs, makeEntry, maxEntries, mirror]
  );

  const addMany = useCallback(
    (items, defaultSource) => {
      if (!Array.isArray(items) || items.length === 0) return;
      items.forEach((it) => {
        if (typeof it === 'string') addLog(it, 'info', defaultSource);
        else addLog(it.message, it.type ?? 'info', it.source ?? defaultSource);
      });
    },
    [addLog]
  );

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, addLog, addMany, addLogGroup, clearLogs, level };
}
