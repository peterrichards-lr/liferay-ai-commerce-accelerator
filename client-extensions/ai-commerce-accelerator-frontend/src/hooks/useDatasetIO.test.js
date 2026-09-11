import { renderHook, act } from '@testing-library/react';
import useDatasetIO from './useDatasetIO';
import notifyUser from '../utils/notifications';
import { saveBlobFile } from '../utils/fileHelper';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/notifications', () => ({ default: vi.fn() }));

vi.mock('../utils/fileHelper', () => ({
  exportJsonFile: vi.fn(),
  saveBlobFile: vi.fn(),
}));

vi.mock('../utils/microservicePaths', () => ({
  EXPORT_COMMERCE_BUNDLE: '/api/v1/export-commerce-bundle',
  EXPORT_COMMERCE_DATA: '/api/v1/export-commerce-data',
  EXTRACT_COMMERCE_BUNDLE: '/api/v1/extract-commerce-bundle',
  IMPORT_COMMERCE_DATA: '/api/v1/import-commerce-data',
}));

// #881: the import control parsed the chosen file, wrote it to the browser
// console and showed a success notification. The endpoint behind it worked and
// the CLI used it; only the button did nothing. These cover what it does now,
// and what a download has to say about a package that is thinner than the
// source it came from (#875).

const headersFrom = (values) => ({
  get: (name) => (name in values ? values[name] : null),
});

const COMPLETE = headersFrom({
  'X-AICA-Media-Images': '22',
  'X-AICA-Media-Pdfs': '22',
  'X-AICA-Media-Source': 'archive',
  'X-AICA-Media-Unresolved': '0',
  'X-AICA-Products-Incomplete': '0',
  'X-AICA-Products-Partial': '3',
});

describe('useDatasetIO', () => {
  let api, addLog, dispatch, buildPayload;

  const renderDatasetHook = (overrides = {}) =>
    renderHook(() =>
      useDatasetIO({
        api,
        addLog,
        buildPayload,
        dispatch,
        isGenerating: false,
        ...overrides,
      })
    );

  const fileEvent = (file) => ({ target: { files: [file], value: 'c:/fake' } });

  const packageFile = () =>
    new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'solara-moto.aicap', {
      type: 'application/zip',
    });

  beforeEach(() => {
    vi.clearAllMocks();
    addLog = vi.fn();
    dispatch = vi.fn();
    buildPayload = vi
      .fn()
      .mockReturnValue({ liferayUrl: 'https://target.example' });
    api = {
      download: vi
        .fn()
        .mockResolvedValue({ blob: new Blob(['zip']), headers: COMPLETE }),
      get: vi.fn().mockResolvedValue({ products: [], metadata: {} }),
      post: vi.fn().mockResolvedValue({ success: true, sessionId: 'import-1' }),
    };
  });

  describe('importing', () => {
    it('posts the file rather than logging it to the console', async () => {
      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.importDataset(fileEvent(packageFile()));
      });

      expect(api.post).toHaveBeenCalledTimes(1);

      const [path, body] = api.post.mock.calls[0];

      expect(path).toBe('/api/v1/import-commerce-data');
      // Multipart under importFile, the way the CLI sends it: the route
      // detects a package by its zip header, so the bytes have to arrive as a
      // file rather than as parsed JSON.
      expect(body).toBeInstanceOf(FormData);
      expect(body.get('importFile')).toBeInstanceOf(File);
      expect(body.get('importFile').name).toBe('solara-moto.aicap');
    });

    it('carries the connection, which the write routes require', async () => {
      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.importDataset(fileEvent(packageFile()));
      });

      expect(api.post.mock.calls[0][1].get('liferayUrl')).toBe(
        'https://target.example'
      );
    });

    it('watches the run it started, since an import is a full workflow', async () => {
      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.importDataset(fileEvent(packageFile()));
      });

      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_ACTIVE_SESSION',
        sessionId: 'import-1',
        flowType: 'import',
      });
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_WORKFLOW_STATUS',
        status: 'running',
      });
    });

    it('reports a refusal as a failure rather than a success', async () => {
      api.post.mockResolvedValue({ success: false, error: 'No file uploaded' });

      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.importDataset(fileEvent(packageFile()));
      });

      expect(dispatch).not.toHaveBeenCalled();
      expect(notifyUser).toHaveBeenCalledWith('No file uploaded', 'danger');
    });

    it('says why when the request itself fails', async () => {
      api.post.mockRejectedValue(new Error('HTTP 413 Payload Too Large'));

      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.importDataset(fileEvent(packageFile()));
      });

      expect(notifyUser).toHaveBeenCalledWith(
        expect.stringContaining('413'),
        'danger'
      );
    });

    it('refuses while a workflow is running', async () => {
      const { result } = renderDatasetHook({ isGenerating: true });

      await act(async () => {
        await result.current.importDataset(fileEvent(packageFile()));
      });

      expect(api.post).not.toHaveBeenCalled();
      expect(notifyUser).toHaveBeenCalledWith(
        expect.stringContaining('finish'),
        'warning'
      );
    });
  });

  describe('downloading a package', () => {
    it('saves the bytes rather than stringifying them', async () => {
      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.exportPackage({ id: 's-1', name: 'Solara Moto' });
      });

      expect(api.download).toHaveBeenCalledWith(
        '/api/v1/export-commerce-bundle?sessionId=s-1'
      );

      const [blob, filename] = saveBlobFile.mock.calls[0];

      expect(blob).toBeInstanceOf(Blob);
      expect(filename).toMatch(/^aica-package-Solara-Moto-.*\.aicap$/);
    });

    it('reads the counts and reports a complete package as success', async () => {
      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.exportPackage({ id: 's-1', name: 'Solara Moto' });
      });

      expect(notifyUser).toHaveBeenCalledWith('Dataset package downloaded');
      expect(addLog).toHaveBeenCalledWith(
        expect.stringContaining('22 image(s), 22 PDF(s)'),
        'info'
      );
      // Optional-only shortfall is detail, not an alarm: usually a blank
      // metaTitle on the source, faithfully reproduced (#886).
      expect(notifyUser).not.toHaveBeenCalledWith(expect.anything(), 'warning');
    });

    it('warns rather than congratulating when the package is short', async () => {
      api.download.mockResolvedValue({
        blob: new Blob(['zip']),
        headers: headersFrom({
          'X-AICA-Media-Images': '20',
          'X-AICA-Media-Pdfs': '22',
          'X-AICA-Media-Unresolved': '2',
          'X-AICA-Products-Incomplete': '1',
        }),
      });

      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.exportPackage({ id: 's-1', name: 'Solara Moto' });
      });

      // The file is still saved - a short package is still worth having - but
      // it must not read as a clean result.
      expect(saveBlobFile).toHaveBeenCalled();
      expect(notifyUser).toHaveBeenCalledWith(
        expect.stringContaining('incomplete'),
        'warning'
      );
      expect(addLog).toHaveBeenCalledWith(
        expect.stringContaining('2 media item(s) could not be included'),
        'warning'
      );
    });

    it('does not report unreadable counts as zero', async () => {
      // A header the microservice does not expose through CORS is absent, not
      // zero, and absent must not read as "nothing was missing".
      api.download.mockResolvedValue({
        blob: new Blob(['zip']),
        headers: headersFrom({}),
      });

      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.exportPackage({ id: 's-1', name: 'Solara Moto' });
      });

      expect(addLog).toHaveBeenCalledWith(
        expect.stringContaining('not readable from this origin'),
        'info'
      );
    });

    it('surfaces the refusal when there is nothing to package', async () => {
      api.download.mockRejectedValue(
        new Error(
          'The run recorded 44 media item(s) and the media archive holds none of them'
        )
      );

      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.exportPackage({ id: 's-1', name: 'Solara Moto' });
      });

      expect(saveBlobFile).not.toHaveBeenCalled();
      expect(addLog).toHaveBeenCalledWith(
        expect.stringContaining('archive holds none of them'),
        'error'
      );
    });
  });

  describe('extracting from an instance', () => {
    it('names the source explicitly, so it cannot be inferred wrongly', async () => {
      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.extractPackage({ source: 'instance' });
      });

      expect(api.download).toHaveBeenCalledWith(
        '/api/v1/extract-commerce-bundle',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            liferayUrl: 'https://target.example',
            source: 'instance',
          }),
        })
      );
    });

    it('will not extract a session without one', async () => {
      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.extractPackage({ source: 'session' });
      });

      expect(api.download).not.toHaveBeenCalled();
      expect(notifyUser).toHaveBeenCalledWith(
        expect.stringContaining('Choose a session'),
        'warning'
      );
    });
  });

  describe('exporting the dataset alone', () => {
    it('always passes the session id, which decides what comes back', async () => {
      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.exportSession({ id: 's-1', name: 'Solara Moto' });
      });

      // Without it the endpoint falls through to a cache tier carrying
      // products, accounts and orders alone, and reports success either way.
      expect(api.get).toHaveBeenCalledWith(
        '/api/v1/export-commerce-data?sessionId=s-1'
      );
    });

    it('accepts a session in either shape, since two screens supply it', async () => {
      const { result } = renderDatasetHook();

      await act(async () => {
        await result.current.exportSession({
          session_id: 's-2',
          session_name: 'From the admin table',
        });
      });

      expect(api.get).toHaveBeenCalledWith(
        '/api/v1/export-commerce-data?sessionId=s-2'
      );
    });
  });
});
