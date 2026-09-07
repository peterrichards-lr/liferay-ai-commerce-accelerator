import { describe, it, expect } from 'vitest';
import { isCancellable } from './sessionStatus';

describe('isCancellable', () => {
  it('allows cancelling a session that is still running', () => {
    for (const status of ['STARTED', 'IN_PROGRESS', 'PENDING']) {
      expect(isCancellable(status)).toBe(true);
    }
  });

  it('refuses a session that has already finished', () => {
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED']) {
      expect(isCancellable(status)).toBe(false);
    }
  });

  it('ignores case, since the status comes from the database', () => {
    expect(isCancellable('completed')).toBe(false);
    expect(isCancellable('started')).toBe(true);
  });

  it('treats an unknown or missing status as cancellable', () => {
    // A session stuck in a state this build does not recognise is exactly the
    // one somebody needs to cancel, so the default must not hide the action.
    expect(isCancellable('SOME_NEW_STATE')).toBe(true);
    expect(isCancellable(undefined)).toBe(true);
    expect(isCancellable(null)).toBe(true);
  });
});
