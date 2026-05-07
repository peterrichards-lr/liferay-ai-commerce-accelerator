import { renderHook, act } from '@testing-library/react';
import useGeneration from './useGeneration';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/formData', () => ({
  toFormData: vi.fn().mockReturnValue('mock-form-data'),
}));

vi.mock('../state/progressSelectors', () => ({
  computeTotalsFromConfig: vi.fn().mockReturnValue({
    products: 1,
    accounts: 2,
    orders: 3,
    images: 4,
    pdfs: 5,
    warehouses: 6,
  }),
}));

vi.mock('../utils/microservicePaths', () => ({
  GENERATE_WORKFLOW: '/api/v1/generate',
}));

describe('useGeneration hook', () => {
  let mockAddLog, mockBuildPayload, mockApi, mockDispatch, mockProgress;

  beforeEach(() => {
    mockAddLog = vi.fn();
    mockBuildPayload = vi.fn().mockReturnValue({ basePayload: 'test' });
    mockApi = {
      post: vi.fn().mockResolvedValue({ sessionId: 'session-123' }),
      get: vi.fn().mockResolvedValue({ success: true }),
    };
    mockDispatch = vi.fn();
    mockProgress = {
      activeSessionId: null,
      products: {},
      accounts: {},
      orders: {},
      images: {},
      pdfs: {},
      warehouses: {},
    };
  });

  it('should block generation if not connected', async () => {
    const { result } = renderHook(() =>
      useGeneration({
        addLog: mockAddLog,
        connectionEstablished: false,
        progress: mockProgress,
      })
    );

    await act(async () => {
      await result.current.generateData({});
    });

    expect(mockAddLog).toHaveBeenCalledWith(
      'Please test the connection first before generating data.',
      'error'
    );
  });

  it('should format JSON payload correctly in normal mode', async () => {
    const { result } = renderHook(() =>
      useGeneration({
        addLog: mockAddLog,
        buildPayload: mockBuildPayload,
        api: mockApi,
        dispatch: mockDispatch,
        forceDemoMode: false,
        generationConfig: { productCount: 1 },
        mountedRef: { current: true },
        progress: mockProgress,
        connectionEstablished: true,
      })
    );

    await act(async () => {
      await result.current.generateData({
        imageMode: 'default',
        pdfMode: 'default',
      });
    });

    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/generate', {
      basePayload: 'test',
      imageMode: 'default',
      pdfMode: 'default',
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_ACTIVE_SESSION',
      sessionId: 'session-123',
      flowType: 'generate',
      totals: expect.any(Object),
    });
  });

  it('should enforce demo mode constraints and payload logic', async () => {
    const { result } = renderHook(() =>
      useGeneration({
        addLog: mockAddLog,
        buildPayload: mockBuildPayload,
        api: mockApi,
        dispatch: mockDispatch,
        forceDemoMode: true,
        generationConfig: { productCount: 1 },
        mountedRef: { current: true },
        progress: mockProgress,
        connectionEstablished: true,
      })
    );

    await act(async () => {
      await result.current.generateData({
        imageMode: 'generate',
        pdfMode: 'generate',
      });
    });

    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/generate', {
      basePayload: 'test',
      imageMode: 'default',
      pdfMode: 'default',
      demoMode: true,
    });
  });

  it('should switch to multipart/form-data if custom files are provided', async () => {
    const { result } = renderHook(() =>
      useGeneration({
        addLog: mockAddLog,
        buildPayload: mockBuildPayload,
        api: mockApi,
        dispatch: mockDispatch,
        forceDemoMode: false,
        generationConfig: { productCount: 1 },
        mountedRef: { current: true },
        progress: mockProgress,
        connectionEstablished: true,
      })
    );

    await act(async () => {
      await result.current.generateData({
        imageMode: 'custom',
        customImageFile: new File([''], 'test.png'),
        pdfMode: 'default',
      });
    });

    // The 'toFormData' mock returns 'mock-form-data'
    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/v1/generate',
      'mock-form-data'
    );
  });

  it('should handle cancel workflow correctly', async () => {
    mockProgress.activeSessionId = 'session-123';

    const { result } = renderHook(() =>
      useGeneration({
        addLog: mockAddLog,
        api: mockApi,
        progress: mockProgress,
      })
    );

    await act(async () => {
      await result.current.cancelWorkflow();
    });

    expect(mockApi.get).toHaveBeenCalledWith(
      '/workflows/sessions/session-123/cancel'
    );
    expect(mockAddLog).toHaveBeenCalledWith(
      '✓ Workflow cancellation confirmed by server.',
      'success'
    );
  });
});
