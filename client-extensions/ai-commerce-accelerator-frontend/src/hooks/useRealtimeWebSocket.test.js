import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import useRealtimeWebSocket, { isServiceSourced } from './useRealtimeWebSocket';
import { useApp } from '../context/AppContext';
import { WEB_SOCKET_EVENTS as E, WS_SCOPE } from '../utils/sharedConstants';

// Mock useApp
vi.mock('../context/AppContext', () => ({
  useApp: vi.fn(),
}));

// Capture the last created socket
let lastSocket = null;

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.send = vi.fn();
    this.close = vi.fn();
    this.readyState = 0; // CONNECTING
    lastSocket = this;
  }
}

describe('useRealtimeWebSocket', () => {
  let mockOnLog;
  let mockOnProgress;
  let mockApi;

  beforeEach(() => {
    lastSocket = null;
    mockApi = {
      get: vi.fn(),
    };

    useApp.mockReturnValue({
      getCorrelationId: () => 'test-correlation-id',
      api: mockApi,
    });

    mockOnLog = vi.fn();
    mockOnProgress = vi.fn();

    vi.stubGlobal('WebSocket', MockWebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('should connect when enabled and microserviceUrl is provided', () => {
    renderHook(() =>
      useRealtimeWebSocket({
        enabled: true,
        microserviceUrl: 'http://localhost:3001',
        onLog: mockOnLog,
        onProgress: mockOnProgress,
      })
    );

    expect(lastSocket).not.toBeNull();
    expect(lastSocket.url).toContain('ws://localhost:3001');
  });

  it('should handle STARTED event for session', () => {
    renderHook(() =>
      useRealtimeWebSocket({
        enabled: true,
        microserviceUrl: 'http://localhost:3001',
        onLog: mockOnLog,
        onProgress: mockOnProgress,
      })
    );

    act(() => {
      lastSocket.onopen();
    });

    const startedMsg = {
      type: E.STARTED,
      scope: WS_SCOPE.SESSION,
      operation: 'generate',
      totals: { products: 10 },
    };

    act(() => {
      lastSocket.onmessage({ data: JSON.stringify(startedMsg) });
    });

    expect(mockOnLog).toHaveBeenCalledWith(
      expect.stringContaining('Workflow started'),
      'info'
    );
    expect(mockOnProgress).toHaveBeenCalledWith({
      type: 'RESET_ALL',
      totals: { products: 10 },
    });
  });

  it('should handle COMPLETED event with partial failures', () => {
    renderHook(() =>
      useRealtimeWebSocket({
        enabled: true,
        microserviceUrl: 'http://localhost:3001',
        onLog: mockOnLog,
        onProgress: mockOnProgress,
      })
    );

    act(() => {
      lastSocket.onopen();
    });

    const partialFailureMsg = {
      type: E.COMPLETED,
      scope: WS_SCOPE.BATCH,
      entityType: 'product',
      batchId: 'B-1',
      successCount: 8,
      failureCount: 2,
      totalCount: 10,
      details: {
        errors: [{ message: 'Bad data' }],
      },
    };

    act(() => {
      lastSocket.onmessage({ data: JSON.stringify(partialFailureMsg) });
    });

    expect(mockOnProgress).toHaveBeenCalledWith({
      type: 'UPDATE_BATCH',
      entity: 'products',
      batchId: 'B-1',
      completed: 8,
      total: 10,
    });

    expect(mockOnProgress).toHaveBeenCalledWith({
      type: 'ADD_ERRORS',
      entity: 'products',
      errors: partialFailureMsg.details.errors,
    });
  });

  it('should hydrate session status on connect if activeSessionId is provided', async () => {
    const sessionId = 'S-1';
    mockApi.get.mockResolvedValue({
      success: true,
      progress: {
        products: { completed: 5, total: 10 },
      },
    });

    renderHook(() =>
      useRealtimeWebSocket({
        enabled: true,
        microserviceUrl: 'http://localhost:3001',
        activeSessionId: sessionId,
        onProgress: mockOnProgress,
      })
    );

    act(() => {
      lastSocket.onopen();
    });

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('S-1/status')
      );
      expect(mockOnProgress).toHaveBeenCalledWith({
        type: 'SET_ACTIVE_SESSION',
        sessionId: 'S-1',
      });
      expect(mockOnProgress).toHaveBeenCalledWith({
        type: 'SET_TOTAL',
        entity: 'products',
        total: 10,
      });
    });
  });

  describe('service log entries', () => {
    const sendServiceLog = (logEntry) => {
      act(() => {
        lastSocket.onmessage({
          data: JSON.stringify({ type: 'LOG_ENTRY', scope: 'log', logEntry }),
        });
      });
    };

    beforeEach(() => {
      renderHook(() =>
        useRealtimeWebSocket({
          enabled: true,
          microserviceUrl: 'http://localhost:3001',
          activeSessionId: 'S-1',
          onLog: mockOnLog,
          onProgress: mockOnProgress,
        })
      );

      act(() => {
        lastSocket.onopen();
      });

      mockOnLog.mockClear();
    });

    it('promotes a WARN to the activity log with its run context', () => {
      sendServiceLog({
        level: 'WARN',
        message: 'Product generation delivered 16 of 50 requested products',
        correlationId: 'ERC-1',
        sessionId: 'SESS-1',
        operation: 'generate-product-data',
      });

      expect(mockOnLog).toHaveBeenCalledWith(
        'Product generation delivered 16 of 50 requested products',
        'warning',
        'service · generate-product-data · session SESS-1 · ERC-1'
      );
    });

    it('promotes an ERROR and falls back to the active session', () => {
      sendServiceLog({
        level: 'ERROR',
        message: 'AI generated data for product violates internal schema',
        correlationId: 'system',
      });

      expect(mockOnLog).toHaveBeenCalledWith(
        'AI generated data for product violates internal schema',
        'error',
        'service · session S-1'
      );
    });

    it('leaves INFO, SUCCESS and DEBUG entries out of the activity log', () => {
      ['INFO', 'SUCCESS', 'DEBUG', 'TRACE'].forEach((level) => {
        sendServiceLog({ level, message: `a ${level} line` });
      });

      expect(mockOnLog).not.toHaveBeenCalled();
    });

    it('stops after a run has spent its entry budget, saying so once', () => {
      for (let i = 0; i < 250; i++) {
        sendServiceLog({
          level: 'WARN',
          message: `SKU S-${i}: dropped 1 option link`,
          sessionId: 'SESS-1',
        });
      }

      const budgetNotices = mockOnLog.mock.calls.filter(([message]) =>
        message.startsWith('Reached 200 service warnings')
      );

      expect(budgetNotices).toHaveLength(1);
      expect(mockOnLog).toHaveBeenCalledTimes(201);
    });

    it('gives the next run its own budget', () => {
      for (let i = 0; i < 250; i++) {
        sendServiceLog({
          level: 'WARN',
          message: `SKU S-${i}: dropped 1 option link`,
          sessionId: 'SESS-1',
        });
      }

      mockOnLog.mockClear();

      sendServiceLog({
        level: 'WARN',
        message: 'a warning from the next run',
        sessionId: 'SESS-2',
      });

      expect(mockOnLog).toHaveBeenCalledWith(
        'a warning from the next run',
        'warning',
        'service · session SESS-2'
      );
    });

    it('does not dispatch progress for a log entry', () => {
      mockOnProgress.mockClear();

      sendServiceLog({ level: 'WARN', message: 'a warning', sessionId: 'S-1' });

      expect(mockOnProgress).not.toHaveBeenCalled();
    });
  });
});

async function waitFor(callback, { timeout = 2000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      callback();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  callback();
}

describe('isServiceSourced', () => {
  // App suppresses the toast for these. A run emits around thirty service
  // warnings, twenty-two of them near-identical per-SKU lines, and thirty
  // toasts is an obstruction rather than a report. The match has to agree
  // with describeServiceLogSource, which is why both use one constant.
  it('recognises an entry the service logger produced', () => {
    expect(isServiceSourced('service')).toBe(true);
    expect(isServiceSourced('service \u00b7 generate-product-data')).toBe(true);
    expect(
      isServiceSourced('service \u00b7 create-skus \u00b7 session SESS-1')
    ).toBe(true);
  });

  it('leaves the hook\u2019s own lifecycle entries alone', () => {
    expect(isServiceSourced('workflow')).toBe(false);
    expect(isServiceSourced('batch')).toBe(false);
    expect(isServiceSourced(undefined)).toBe(false);
  });

  // "services" is not "service ·" - a prefix test without the separator would
  // silence an unrelated source that merely starts the same way.
  it('does not match a source that merely begins with the same letters', () => {
    expect(isServiceSourced('services')).toBe(false);
    expect(isServiceSourced('service-worker')).toBe(false);
  });
});
