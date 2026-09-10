import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import useActivityLog from './useActivityLog';
import useLogExport from './useLogExport';

vi.mock('../utils/notifications', () => ({ default: vi.fn() }));

const exported = [];

vi.mock('../utils/fileHelper', () => ({
  exportJsonFile: (data, filename) => exported.push({ data, filename }),
}));

const progress = {
  activeFlowType: 'generate',
  activeSessionId: 'session-1',
  workflowStatus: 'COMPLETED',
  products: { total: 49, completed: 49 },
  accounts: {},
  orders: {},
  images: {},
  pdfs: {},
  warehouses: {},
};

const config = {
  liferayUrl: 'http://localhost:8080',
  microserviceUrl: 'http://localhost:8081',
  batchSize: 10,
  currencyCode: 'USD',
};

const generationConfig = { sessionName: 'Solara Moto' };

/**
 * Drives the real activity log and hands its buffer to the exporter, because
 * the defect in #811 lives in the seam between them: the hook drops entries
 * and the exporter writes down what survived.
 */
const renderExporter = ({ maxEntries }) =>
  renderHook(() => {
    const activityLog = useActivityLog({
      hydrateOnMount: false,
      level: 'debug',
      maxEntries,
      mirrorToConsole: false,
      storageKey: `test_activity_log_${maxEntries}`,
    });

    const { exportLogs } = useLogExport({
      config,
      generationConfig,
      getLogStats: activityLog.getLogStats,
      logs: activityLog.logs,
      progress,
    });

    return { ...activityLog, exportLogs };
  });

const emit = (result, entries) =>
  act(() => {
    entries.forEach(({ message, type }) =>
      result.current.addLog(message, type)
    );
  });

/** `count` distinct entries of one type, distinct so the dedupe window misses. */
const stream = (type, count, prefix) =>
  Array.from({ length: count }, (_, index) => ({
    message: `${prefix} ${index}`,
    type,
  }));

describe('useLogExport truncation reporting (#811)', () => {
  beforeEach(() => {
    exported.length = 0;
    localStorage.clear();
  });

  it('records what the buffer discarded, so counts do not read as totals', () => {
    const { result } = renderExporter({ maxEntries: 10 });

    // A run shaped like the one in #811: warnings early, noise last, so the
    // warnings are exactly what a tail-biased buffer throws away.
    emit(result, [
      ...stream('warning', 4, 'price entry skipped'),
      ...stream('error', 2, 'option link dropped'),
      ...stream('success', 20, 'image uploaded'),
    ]);

    expect(result.current.logs).toHaveLength(10);

    act(() => result.current.exportLogs());

    const { data } = exported[0];

    expect(data.activityLogCoverage).toEqual({
      complete: false,
      dropped: 16,
      droppedByType: { ERROR: 2, SUCCESS: 10, WARNING: 4 },
      generated: 26,
      included: 10,
      maxEntries: 10,
    });

    // The array itself has to say so too. A reader who scrolls the log and
    // never opens the summary must still see where the record stops.
    const oldest = data.activityLogs[data.activityLogs.length - 1];

    expect(oldest.type).toBe('TRUNCATED');
    expect(oldest.message).toMatch(/16 earlier entries/);
    expect(oldest.message).toMatch(/floor/i);
  });

  it('says a complete log is complete, so silence is never the answer', () => {
    const { result } = renderExporter({ maxEntries: 100 });

    emit(result, stream('info', 12, 'product created'));

    act(() => result.current.exportLogs());

    const { data } = exported[0];

    expect(data.activityLogCoverage).toEqual({
      complete: true,
      dropped: 0,
      droppedByType: {},
      generated: 12,
      included: 12,
      maxEntries: 100,
    });
    expect(data.activityLogs.some((entry) => entry.type === 'TRUNCATED')).toBe(
      false
    );
  });

  it('counts only entries the log actually kept, not ones it filtered out', () => {
    const { result } = renderHook(() => {
      const activityLog = useActivityLog({
        hydrateOnMount: false,
        level: 'warn',
        maxEntries: 5,
        mirrorToConsole: false,
        storageKey: 'test_activity_log_level',
      });

      const { exportLogs } = useLogExport({
        config,
        generationConfig,
        getLogStats: activityLog.getLogStats,
        logs: activityLog.logs,
        progress,
      });

      return { ...activityLog, exportLogs };
    });

    // Below the configured level: never logged, so never "dropped" either.
    emit(result, stream('debug', 30, 'sdk call'));
    emit(result, stream('warning', 3, 'sku inactive'));

    act(() => result.current.exportLogs());

    expect(exported[0].data.activityLogCoverage).toEqual({
      complete: true,
      dropped: 0,
      droppedByType: {},
      generated: 3,
      included: 3,
      maxEntries: 5,
    });
  });

  it('says the coverage is unknown when no source of counts was given', () => {
    const { result } = renderHook(() =>
      useLogExport({
        config,
        generationConfig,
        logs: [{ message: 'a', timestamp: '10:00:00', type: 'info' }],
        progress,
      })
    );

    act(() => result.current.exportLogs());

    // Nulls rather than an absent block or an assumed `complete: true`: an
    // exporter that cannot tell must not answer the question (#811).
    expect(exported[0].data.activityLogCoverage).toEqual({
      complete: null,
      dropped: null,
      droppedByType: {},
      generated: null,
      included: 1,
      maxEntries: null,
    });
  });
});
