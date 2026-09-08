import { renderHook, act } from '@testing-library/react';
import useMediaGeneration from './useMediaGeneration';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/notifications', () => ({ default: vi.fn() }));

vi.mock('../utils/microservicePaths', () => ({
  GENERATE_MEDIA: '/api/v1/generate/media',
}));

describe('useMediaGeneration hook', () => {
  let mockApi, mockAddLog, mockDispatch, mockBuildPayload;

  const renderMediaHook = (overrides = {}) =>
    renderHook(() =>
      useMediaGeneration({
        api: mockApi,
        addLog: mockAddLog,
        buildPayload: mockBuildPayload,
        dispatch: mockDispatch,
        isGenerating: false,
        ...overrides,
      })
    );

  beforeEach(() => {
    mockAddLog = vi.fn();
    mockDispatch = vi.fn();
    mockBuildPayload = vi
      .fn()
      .mockReturnValue({ liferayUrl: 'http://localhost:8080' });
    mockApi = {
      post: vi.fn().mockResolvedValue({
        sessionId: 'media-1',
        imageCount: 3,
        pdfCount: 1,
      }),
    };
  });

  it('sends the explicit confirmation the backend requires', async () => {
    const { result } = renderMediaHook();

    await act(async () => {
      await result.current.generateMedia({ sourceSessionId: 'src-1' });
    });

    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/v1/generate/media',
      expect.objectContaining({
        sourceSessionId: 'src-1',
        mediaScope: 'missing',
        confirmMediaGeneration: true,
      })
    );
  });

  it('tracks the new media session so progress is reported against it', async () => {
    const { result } = renderMediaHook();

    await act(async () => {
      await result.current.generateMedia({
        sourceSessionId: 'src-1',
        scope: 'all',
      });
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_ACTIVE_SESSION',
      sessionId: 'media-1',
      flowType: 'media',
      totals: { images: 3, pdfs: 1 },
    });
  });

  it('does not start a run while another workflow is in progress', async () => {
    const { result } = renderMediaHook({ isGenerating: true });

    await act(async () => {
      await result.current.generateMedia({ sourceSessionId: 'src-1' });
    });

    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('reports a refusal from the backend without claiming a session', async () => {
    mockApi.post.mockResolvedValue({
      success: false,
      error: 'Every product in this dataset already has the media requested.',
    });

    const { result } = renderMediaHook();

    await act(async () => {
      await result.current.generateMedia({ sourceSessionId: 'src-1' });
    });

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockAddLog).toHaveBeenCalledWith(
      expect.stringContaining('already has the media requested'),
      'warning'
    );
  });
});
