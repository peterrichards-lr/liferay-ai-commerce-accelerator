import { renderHook, act } from '@testing-library/react';
import useMediaGeneration from './useMediaGeneration';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/notifications', () => ({ default: vi.fn() }));

vi.mock('../utils/microservicePaths', () => ({
  GENERATE_MEDIA: '/api/v1/generate/media',
}));

/** What the generator form holds while the media modal is open. */
const GENERATION_CONFIG = {
  accountCount: 10,
  brandName: 'Solara Moto',
  demoMode: false,
  imageMode: 'ai',
  imageRatio: 40,
  imageStyle: 'studio',
  orderCount: 50,
  pdfContentType: 'datasheet',
  pdfMode: 'placeholder',
  pdfRatio: 60,
  productCount: 25,
  sessionName: 'a generation run',
};

describe('useMediaGeneration hook', () => {
  let mockApi, mockAddLog, mockDispatch, mockBuildPayload;

  const renderMediaHook = (overrides = {}) =>
    renderHook(() =>
      useMediaGeneration({
        api: mockApi,
        addLog: mockAddLog,
        buildPayload: mockBuildPayload,
        dispatch: mockDispatch,
        generationConfig: GENERATION_CONFIG,
        isGenerating: false,
        ...overrides,
      })
    );

  const postedPayload = () => mockApi.post.mock.calls[0][1];

  beforeEach(() => {
    mockAddLog = vi.fn();
    mockDispatch = vi.fn();
    // The whitelisted builder's contract: it names the connection and commerce
    // fields and merges whatever the caller hands it. See useCommerceData.
    mockBuildPayload = vi.fn((payloadOverrides = {}) => ({
      liferayUrl: 'http://localhost:8080',
      ...payloadOverrides,
    }));
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

  /**
   * The route reads `imageMode` and `pdfMode` off the request and refuses the
   * run when both read as 'none' - which is what an absent field becomes. They
   * used to arrive only because App.jsx spread the whole generation config into
   * every payload, so collapsing onto the whitelisted builder without naming
   * them would have made every media run a 400. See #1044.
   */
  it('sends the media settings the route gates on', async () => {
    const { result } = renderMediaHook();

    await act(async () => {
      await result.current.generateMedia({ sourceSessionId: 'src-1' });
    });

    expect(postedPayload()).toMatchObject({
      demoMode: false,
      imageMode: 'ai',
      imageRatio: 40,
      imageStyle: 'studio',
      pdfContentType: 'datasheet',
      pdfMode: 'placeholder',
      pdfRatio: 60,
    });
  });

  it('leaves the rest of the generator form behind', async () => {
    const { result } = renderMediaHook();

    await act(async () => {
      await result.current.generateMedia({ sourceSessionId: 'src-1' });
    });

    const payload = postedPayload();

    expect(payload).not.toHaveProperty('productCount');
    expect(payload).not.toHaveProperty('accountCount');
    expect(payload).not.toHaveProperty('orderCount');
    expect(payload).not.toHaveProperty('brandName');
    // A media run names itself after the session it attaches to, and the route
    // only does that when the request names no session of its own.
    expect(payload).not.toHaveProperty('sessionName');
  });

  it('attaches a chosen image as multipart rather than as a field', async () => {
    const customImageFile = new File(['jpeg'], 'hero.jpg', {
      type: 'image/jpeg',
    });

    const { result } = renderMediaHook({
      generationConfig: {
        ...GENERATION_CONFIG,
        customImageFile,
        imageMode: 'custom',
      },
    });

    await act(async () => {
      await result.current.generateMedia({ sourceSessionId: 'src-1' });
    });

    const body = postedPayload();

    expect(body).toBeInstanceOf(FormData);
    expect(body.get('customImageFile')).toBeInstanceOf(File);
    expect(body.get('customImageFile').name).toBe('hero.jpg');
    expect(body.get('imageMode')).toBe('custom');
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
