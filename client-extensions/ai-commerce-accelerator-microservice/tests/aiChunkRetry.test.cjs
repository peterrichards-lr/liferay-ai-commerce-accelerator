const { AIService } = require('../services/aiService.cjs');

const classify = AIService._isTransientAIError;
const withRetry = AIService.prototype._withChunkRetry;

const meta = { entityType: 'products', index: 2, total: 5 };
const svc = (retry) => ({
  ctx: { logger: { warn: () => {} } },
  retryRuntime: { retry },
});

describe('AIService._isTransientAIError', () => {
  it('retries the statuses that can succeed on a second attempt', () => {
    for (const status of [408, 409, 429, 500, 502, 503, 529]) {
      expect(classify({ status })).toBe(true);
    }
  });

  it('does not retry a request that will fail the same way again', () => {
    // The reason PromoGenerator._runWithRetry could not be lifted: it counts
    // 400 and 404 as transient, which is right for a Liferay read racing
    // eventual consistency and wrong for a malformed AI request.
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classify({ status })).toBe(false);
    }
  });

  it('reads a status from the axios shape as well as the SDK shape', () => {
    expect(classify({ response: { status: 503 } })).toBe(true);
    expect(classify({ response: { status: 400 } })).toBe(false);
  });

  it('recognises a timeout or dropped connection, which carry no status', () => {
    expect(classify({ name: 'APIConnectionTimeoutError' })).toBe(true);
    expect(classify({ name: 'APIConnectionError' })).toBe(true);
    expect(classify({ message: 'Request timed out.' })).toBe(true);
    expect(classify({ message: 'socket hang up' })).toBe(true);
    expect(classify({ message: 'read ECONNRESET' })).toBe(true);
  });

  it('treats an unrecognised failure as permanent', () => {
    // Deliberate: an unknown transient error costs no more than today's
    // behaviour, whereas retrying our own bugs burns tokens and delays the
    // report.
    expect(classify({ message: 'Cannot read properties of undefined' })).toBe(
      false
    );
    expect(classify(null)).toBe(false);
  });
});

describe('AIService._withChunkRetry', () => {
  it('returns the first success without retrying', async () => {
    let calls = 0;
    const runtime = { retry: { baseDelayMs: 1, maxDelayMs: 2, maxRetries: 3 } };

    const result = await withRetry.call(svc(), runtime, meta, async () => {
      calls += 1;
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries a transient failure and succeeds on a later attempt', async () => {
    let calls = 0;
    const runtime = { retry: { baseDelayMs: 1, maxDelayMs: 2, maxRetries: 3 } };

    const result = await withRetry.call(svc(), runtime, meta, async () => {
      calls += 1;
      if (calls < 3) {
        throw Object.assign(new Error('Request timed out.'), { status: 429 });
      }
      return 'recovered';
    });

    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('gives up after maxRetries and rethrows the original error', async () => {
    let calls = 0;
    const runtime = { retry: { baseDelayMs: 1, maxDelayMs: 2, maxRetries: 2 } };

    await expect(
      withRetry.call(svc(), runtime, meta, async () => {
        calls += 1;
        throw Object.assign(new Error('upstream exploded'), { status: 503 });
      })
    ).rejects.toThrow('upstream exploded');

    // One initial attempt plus two retries.
    expect(calls).toBe(3);
  });

  it('does not retry a permanent failure, however many retries are allowed', async () => {
    let calls = 0;
    const runtime = { retry: { baseDelayMs: 1, maxDelayMs: 2, maxRetries: 5 } };

    await expect(
      withRetry.call(svc(), runtime, meta, async () => {
        calls += 1;
        throw Object.assign(new Error('bad request'), { status: 400 });
      })
    ).rejects.toThrow('bad request');

    expect(calls).toBe(1);
  });

  it('honours maxRetries of zero as "do not retry"', async () => {
    let calls = 0;
    const runtime = { retry: { baseDelayMs: 1, maxDelayMs: 2, maxRetries: 0 } };

    await expect(
      withRetry.call(svc(), runtime, meta, async () => {
        calls += 1;
        throw Object.assign(new Error('nope'), { status: 500 });
      })
    ).rejects.toThrow('nope');

    expect(calls).toBe(1);
  });

  it('backs off exponentially but never beyond maxDelayMs', async () => {
    // No fake timers here: capturing setTimeout after useFakeTimers schedules
    // onto a clock nothing advances, which deadlocks. Firing the callback
    // immediately records the delay that was asked for without waiting for it.
    const waits = [];
    const spy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((fn, ms) => {
        waits.push(ms);
        fn();
        return 0;
      });

    try {
      const runtime = {
        retry: { baseDelayMs: 1000, maxDelayMs: 3000, maxRetries: 4 },
      };

      await expect(
        withRetry.call(svc(), runtime, meta, async () => {
          throw Object.assign(new Error('busy'), { status: 429 });
        })
      ).rejects.toThrow('busy');

      // 1000, 2000, then capped at 3000 rather than growing to 4000 and 8000.
      expect(waits).toEqual([1000, 2000, 3000, 3000]);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to sane defaults when no retry config was resolved', async () => {
    let calls = 0;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => {
      fn();
      return 0;
    });

    try {
      await expect(
        withRetry.call(svc(), undefined, meta, async () => {
          calls += 1;
          throw Object.assign(new Error('busy'), { status: 429 });
        })
      ).rejects.toThrow('busy');

      // Default maxRetries is 2, so three attempts in total.
      expect(calls).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('AIService.getRuntimeAIConfig retry resolution', () => {
  // The defect in #822 was not a missing mechanism - it was that the
  // configuration panel offered these three settings and nothing read them.
  // These assertions are the ones that fail if that regresses.
  const runtimeFor = async (retry) => {
    const svc = Object.create(AIService.prototype);

    svc.ctx = {
      config: {
        getAIChunkSizes: async () => ({}),
        getAIConfig: async () => ({
          apiKey: 'sk-test',
          defaultModel: 'gpt-4o',
          provider: 'openai',
          retry,
        }),
        getAIKey: async () => 'sk-test',
        getAIMediaKey: async () => null,
      },
      logger: { debug() {}, error() {}, info() {}, warn() {} },
    };

    return svc.getRuntimeAIConfig({});
  };

  it('reads the values an operator set in the configuration panel', async () => {
    const runtime = await runtimeFor({
      baseDelayMs: 250,
      maxDelayMs: 4000,
      maxRetries: 5,
    });

    expect(runtime.retry).toEqual({
      baseDelayMs: 250,
      maxDelayMs: 4000,
      maxRetries: 5,
    });
  });

  it('falls back to defaults when the config holds nothing', async () => {
    const runtime = await runtimeFor(undefined);

    expect(runtime.retry).toEqual({
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      maxRetries: 2,
    });
  });

  it('keeps a configured zero rather than treating it as absence', async () => {
    const runtime = await runtimeFor({ maxRetries: 0 });

    expect(runtime.retry.maxRetries).toBe(0);
  });

  it('clamps an implausible retry count instead of honouring it', async () => {
    expect((await runtimeFor({ maxRetries: 999 })).retry.maxRetries).toBe(10);
    expect((await runtimeFor({ maxRetries: -3 })).retry.maxRetries).toBe(0);
  });
});
