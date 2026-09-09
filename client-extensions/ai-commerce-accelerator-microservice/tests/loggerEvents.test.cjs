const { logger } = require('../utils/logger.cjs');

describe('logger log events', () => {
  let events;
  let capture;
  let writeToFile;
  let stdoutWrite;
  let stderrWrite;

  beforeEach(() => {
    events = [];
    capture = (event) => events.push(event);
    logger.on('log', capture);

    writeToFile = vi.spyOn(logger, '_writeToFile').mockImplementation(() => {});
    stdoutWrite = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    stderrWrite = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    logger.off('log', capture);
    writeToFile.mockRestore();
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  it('carries the correlationId of the entry that was logged', () => {
    logger.warn('SKU S-1: dropped 1 option link', {
      correlationId: 'ERC-1',
      sessionId: 'SESS-1',
      operation: 'generate-product-data',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      level: 'WARN',
      message: 'SKU S-1: dropped 1 option link',
      correlationId: 'ERC-1',
      sessionId: 'SESS-1',
      operation: 'generate-product-data',
    });
  });

  it('falls back to system when the entry has no correlationId', () => {
    logger.error('AI generated data for product violates internal schema');

    expect(events[0]).toMatchObject({
      level: 'ERROR',
      correlationId: 'system',
    });
    expect(events[0].sessionId).toBeUndefined();
  });

  it('leaves a reused meta object intact so later entries keep their context', () => {
    const meta = { correlationId: 'ERC-2', sessionId: 'SESS-2' };

    logger.error('first failure', meta);
    logger.error('second failure', meta);

    expect(meta).toEqual({ correlationId: 'ERC-2', sessionId: 'SESS-2' });
    expect(events.map((e) => e.correlationId)).toEqual(['ERC-2', 'ERC-2']);
  });
});
