import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import useActivityLog, { DEFAULT_MAX_ENTRIES } from './useActivityLog';

const STORAGE_KEY = 'test_activity_log';

const renderLog = (options = {}) =>
  renderHook(() =>
    useActivityLog({
      level: 'debug',
      maxEntries: 5,
      mirrorToConsole: false,
      storageKey: STORAGE_KEY,
      ...options,
    })
  );

const emit = (result, count, type = 'info', prefix = 'entry') =>
  act(() => {
    for (let index = 0; index < count; index += 1) {
      result.current.addLog(`${prefix} ${index}`, type);
    }
  });

describe('useActivityLog buffer accounting (#811)', () => {
  beforeEach(() => localStorage.clear());

  it('keeps a run of the size #811 describes without truncating at all', () => {
    // 500 was the cap; the 50-product run that prompted the issue filled it
    // exactly, so the default has to clear that mark by a margin.
    expect(DEFAULT_MAX_ENTRIES).toBeGreaterThan(500);
  });

  it('counts what it dropped, by type', () => {
    const { result } = renderLog();

    emit(result, 2, 'error', 'failed');
    emit(result, 8, 'success', 'created');

    expect(result.current.getLogStats()).toEqual({
      dropped: 5,
      droppedByType: { ERROR: 2, SUCCESS: 3 },
      generated: 10,
      included: 5,
      maxEntries: 5,
    });
  });

  it('folds warn and warning together so a tally is not split', () => {
    const { result } = renderLog({ maxEntries: 1 });

    emit(result, 1, 'warn', 'a');
    emit(result, 1, 'warning', 'b');

    expect(result.current.getLogStats().droppedByType).toEqual({ WARNING: 1 });
  });

  it('remembers across a reload that entries were already dropped', () => {
    const first = renderLog();

    emit(first.result, 9, 'debug', 'sdk');
    first.unmount();

    const second = renderLog({ hydrateOnMount: true });

    expect(second.result.current.getLogStats()).toEqual({
      dropped: 4,
      droppedByType: { DEBUG: 4 },
      generated: 9,
      included: 5,
      maxEntries: 5,
    });
  });

  it('still reads a log persisted in the old bare-array format', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: '1', message: 'old', timestamp: '10:00:00', type: 'info' },
      ])
    );

    const { result } = renderLog({ hydrateOnMount: true });

    expect(result.current.logs).toHaveLength(1);
    expect(result.current.getLogStats()).toMatchObject({
      dropped: 0,
      generated: 1,
      included: 1,
    });
  });

  it('forgets the dropped count when the operator clears the log', () => {
    const { result } = renderLog();

    emit(result, 9, 'info', 'noise');
    act(() => result.current.clearLogs());

    expect(result.current.getLogStats()).toEqual({
      dropped: 0,
      droppedByType: {},
      generated: 0,
      included: 0,
      maxEntries: 5,
    });
  });

  it('counts a grouped batch, header included, exactly once', () => {
    const { result } = renderLog({ maxEntries: 100 });

    act(() =>
      result.current.addLogGroup('Warehouses', [
        { message: 'north', type: 'success' },
        { message: 'south', type: 'success' },
      ])
    );

    expect(result.current.getLogStats()).toMatchObject({
      dropped: 0,
      generated: 3,
      included: 3,
    });
  });
});
