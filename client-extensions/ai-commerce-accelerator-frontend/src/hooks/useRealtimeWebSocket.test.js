import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import useRealtimeWebSocket from './useRealtimeWebSocket';
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
