import { describe, it, expect } from 'vitest';
import { sessionDurationMs, formatDuration } from './sessionDuration';

const at = (iso) => new Date(iso).getTime();

describe('sessionDurationMs', () => {
  it('measures a finished session from start to its last write', () => {
    const ms = sessionDurationMs({
      status: 'COMPLETED',
      created_at: '2026-09-07T17:00:00.000Z',
      updated_at: '2026-09-07T17:04:12.000Z',
    });

    expect(ms).toBe(252000);
  });

  it('measures a running session against now', () => {
    const ms = sessionDurationMs(
      {
        status: 'STARTED',
        created_at: '2026-09-07T17:00:00.000Z',
        updated_at: '2026-09-07T17:00:30.000Z',
      },
      at('2026-09-07T17:05:00.000Z')
    );

    // Not 30s: a running session is still going, whatever its last write says.
    expect(ms).toBe(300000);
  });

  it('treats failed and cancelled as finished', () => {
    for (const status of ['FAILED', 'CANCELLED']) {
      expect(
        sessionDurationMs({
          status,
          created_at: '2026-09-07T17:00:00.000Z',
          updated_at: '2026-09-07T17:01:00.000Z',
        })
      ).toBe(60000);
    }
  });

  it('never reports a negative duration', () => {
    expect(
      sessionDurationMs({
        status: 'COMPLETED',
        created_at: '2026-09-07T17:05:00.000Z',
        updated_at: '2026-09-07T17:00:00.000Z',
      })
    ).toBe(0);
  });

  it('returns null when there is nothing to measure', () => {
    expect(sessionDurationMs(null)).toBeNull();
    expect(sessionDurationMs({ status: 'COMPLETED' })).toBeNull();
    expect(
      sessionDurationMs({ status: 'COMPLETED', created_at: 'not a date' })
    ).toBeNull();
  });
});

describe('formatDuration', () => {
  it('reads naturally at each scale', () => {
    expect(formatDuration(8000)).toBe('8s');
    expect(formatDuration(252000)).toBe('4m 12s');
    expect(formatDuration(3960000)).toBe('1h 06m');
  });

  it('shows a dash when there is no duration', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });
});
