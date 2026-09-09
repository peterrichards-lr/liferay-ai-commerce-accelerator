const { AIService } = require('../services/aiService.cjs');

// _withChunkProgress is exercised directly rather than through a whole
// generation run. The behaviour that matters is narrow and easy to get wrong:
// it must report, it must never break the thing it is reporting on, and it must
// not leave a timer behind.
const wrap = AIService.prototype._withChunkProgress;

const makeProgress = () => {
  const calls = [];
  return {
    calls,
    stepProgress: (payload) => calls.push(payload),
  };
};

describe('AIService._withChunkProgress', () => {
  it('reports the chunks completed before and after the one it wraps', async () => {
    const progress = makeProgress();
    const svc = { ctx: { progress } };

    const result = await wrap.call(
      svc,
      { sessionId: 'S1', correlationId: 'C1' },
      { entityType: 'products', index: 3, total: 10 },
      async () => 'chunk-payload'
    );

    expect(result).toBe('chunk-payload');

    const counts = progress.calls.map((c) => c.processedCount);
    expect(counts).toEqual([2, 3]);

    expect(progress.calls[0]).toMatchObject({
      correlationId: 'C1',
      entityType: 'products',
      operation: 'ai-generate',
      sessionId: 'S1',
      totalCount: 10,
    });
  });

  it('reports the chunk settling even when it throws, and rethrows', async () => {
    const progress = makeProgress();
    const svc = { ctx: { progress } };
    const boom = new Error('provider timed out');

    await expect(
      wrap.call(
        svc,
        { sessionId: 'S1' },
        { entityType: 'orders', index: 1, total: 4 },
        async () => {
          throw boom;
        }
      )
    ).rejects.toThrow('provider timed out');

    // The failure is still progress: the run has moved past this chunk, and a
    // caller that only reported on success would leave the count stuck.
    expect(progress.calls.map((c) => c.processedCount)).toEqual([0, 1]);
  });

  it('runs the chunk untouched when there is no progress service', async () => {
    const svc = { ctx: {} };

    await expect(
      wrap.call(
        svc,
        { sessionId: 'S1' },
        { entityType: 'x', index: 1, total: 1 },
        async () => 'ok'
      )
    ).resolves.toBe('ok');
  });

  it('runs the chunk untouched when no sessionId was threaded through', async () => {
    const progress = makeProgress();
    const svc = { ctx: { progress } };

    // The AI service has no session of its own. A caller that did not pass one
    // must degrade to silence rather than throwing inside a generation run.
    await expect(
      wrap.call(
        svc,
        {},
        { entityType: 'x', index: 1, total: 1 },
        async () => 'ok'
      )
    ).resolves.toBe('ok');
    expect(progress.calls).toHaveLength(0);
  });

  it('does not let a failing progress service fail the run', async () => {
    const svc = {
      ctx: {
        progress: {
          stepProgress: () => {
            throw new Error('websocket is gone');
          },
        },
      },
    };

    await expect(
      wrap.call(
        svc,
        { sessionId: 'S1' },
        { entityType: 'products', index: 2, total: 5 },
        async () => 'still-generated'
      )
    ).resolves.toBe('still-generated');
  });

  it('re-announces a chunk that is still running, then stops when it settles', async () => {
    vi.useFakeTimers();

    try {
      const progress = makeProgress();
      const svc = { ctx: { progress } };

      let release;
      const pending = wrap.call(
        svc,
        { sessionId: 'S1' },
        { entityType: 'products', index: 4, total: 10 },
        () => new Promise((resolve) => (release = resolve))
      );

      // Two heartbeats at 15s apiece, all reporting the same count: the value
      // does not change, the arrival is the liveness signal.
      await vi.advanceTimersByTimeAsync(31000);
      expect(progress.calls.map((c) => c.processedCount)).toEqual([3, 3, 3]);

      release('done');
      await pending;

      expect(progress.calls.map((c) => c.processedCount)).toEqual([3, 3, 3, 4]);

      // The interval must be cleared, or a long run accumulates one timer per
      // chunk and keeps emitting for chunks that finished.
      await vi.advanceTimersByTimeAsync(60000);
      expect(progress.calls.map((c) => c.processedCount)).toEqual([3, 3, 3, 4]);
    } finally {
      vi.useRealTimers();
    }
  });
});
