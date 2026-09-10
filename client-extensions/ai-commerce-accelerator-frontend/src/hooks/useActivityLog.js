import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * How many entries the buffer keeps.
 *
 * The buffer is bounded on purpose: it is held in memory and rewritten to
 * localStorage on every entry, so an hour-long run with no ceiling is its own
 * defect. 500 was too low - the 50-product run in #811 filled it exactly and
 * discarded everything before the media phase, which is the noisiest and the
 * least interesting. 2000 covers a run of that size whole, and at roughly
 * 200 bytes an entry costs about 400KB of the 5MB localStorage quota.
 *
 * Past that the buffer still truncates. What changed in #811 is that it now
 * counts what it threw away, so an export can say so.
 */
export const DEFAULT_MAX_ENTRIES = 2000;

/**
 * The vocabulary the export reports types in.
 *
 * `warn` and `warning` are the same severity everywhere else in this hook, so
 * they are folded together here too: a reader tallying warnings in an export
 * should not have to know that two spellings reached the log.
 */
export function normaliseType(type) {
  const upper = String(type ?? 'INFO').toUpperCase();

  return upper === 'WARN' ? 'WARNING' : upper;
}

function mergeCounts(left, right) {
  return Object.entries(right).reduce(
    (counts, [type, count]) => {
      counts[type] = (counts[type] || 0) + count;

      return counts;
    },
    { ...left }
  );
}

function tallyByType(entries) {
  return entries.reduce((counts, entry) => {
    const key = normaliseType(entry?.type);

    counts[key] = (counts[key] || 0) + 1;

    return counts;
  }, {});
}

/**
 * Restores the buffer and, with it, what a previous session already dropped.
 *
 * Older builds persisted a bare array. Those are still read - the counts are
 * then seeded from the surviving entries, which understates a session that had
 * already truncated but never overstates what the buffer holds.
 */
function readStoredLog(storageKey, maxEntries) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null');

    if (Array.isArray(parsed)) {
      const entries = parsed.slice(0, maxEntries);

      return { entries, generatedByType: tallyByType(entries) };
    }

    if (parsed && Array.isArray(parsed.entries)) {
      const entries = parsed.entries.slice(0, maxEntries);

      return {
        entries,
        generatedByType: parsed.generatedByType || tallyByType(entries),
      };
    }
  } catch {
    /* ignore */
  }

  return { entries: [], generatedByType: {} };
}

export default function useActivityLog({
  level = 'info',
  maxEntries = DEFAULT_MAX_ENTRIES,
  dedupeWindowMs = 1000,
  mirrorToConsole = true,
  storageKey = 'aica_activity_log', // prefixed with aica_ for factory reset management
  hydrateOnMount = true,
} = {}) {
  const [stored] = useState(() =>
    hydrateOnMount && typeof window !== 'undefined'
      ? readStoredLog(storageKey, maxEntries)
      : { entries: [], generatedByType: {} }
  );

  const [logs, setLogs] = useState(stored.entries);

  // What a previous session had already counted, kept separate from this
  // session's tally so clearing the log can forget both.
  const [restoredByType, setRestoredByType] = useState(stored.generatedByType);

  // Every entry this session's log has accepted, whether or not it survived
  // the cap. Counted here rather than derived inside the state updater because
  // React may invoke an updater twice; an event handler runs once.
  const generatedByTypeRef = useRef({});

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
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          entries: logs.slice(0, maxEntries),
          generatedByType: mergeCounts(
            restoredByType,
            generatedByTypeRef.current
          ),
          version: 2,
        })
      );
    } catch {
      /* ignore storage errors */
    }
  }, [logs, maxEntries, restoredByType, storageKey]);

  /** Records an entry the log accepted, before the cap decides its fate. */
  const countGenerated = useCallback((entries) => {
    const counts = generatedByTypeRef.current;

    entries.forEach((entry) => {
      const key = normaliseType(entry?.type);

      counts[key] = (counts[key] || 0) + 1;
    });
  }, []);

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

      countGenerated([entry]);
      setLogs((prev) => [entry, ...prev].slice(0, maxEntries));
      mirror(entry);
    },
    [countGenerated, dedupeWindowMs, makeEntry, maxEntries, mirror, shouldLog]
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

      countGenerated(wouldDupeHeader ? entries.slice(1) : entries);

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
    [countGenerated, dedupeWindowMs, makeEntry, maxEntries, mirror]
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

  const clearLogs = useCallback(() => {
    generatedByTypeRef.current = {};
    setRestoredByType({});
    setLogs([]);
  }, []);

  /**
   * What the buffer holds against what the run produced (#811).
   *
   * Dropped counts are a subtraction rather than a tally kept at eviction
   * time: the cap is applied inside a state updater, which React is free to
   * run more than once, so anything counted there would over-report.
   */
  const getLogStats = useCallback(() => {
    const generatedByType = mergeCounts(
      restoredByType,
      generatedByTypeRef.current
    );
    const includedByType = tallyByType(logs);
    const droppedByType = {};

    Object.entries(generatedByType).forEach(([type, count]) => {
      const dropped = count - (includedByType[type] || 0);

      if (dropped > 0) droppedByType[type] = dropped;
    });

    const generated = Object.values(generatedByType).reduce(
      (total, count) => total + count,
      0
    );

    return {
      dropped: Math.max(generated - logs.length, 0),
      droppedByType,
      generated,
      included: logs.length,
      maxEntries,
    };
  }, [logs, maxEntries, restoredByType]);

  return {
    logs,
    addLog,
    addMany,
    addLogGroup,
    clearLogs,
    getLogStats,
    level,
  };
}
