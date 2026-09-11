import { useCallback, useState } from 'react';
import notifyUser from '../utils/notifications';
import { exportJsonFile, saveBlobFile } from '../utils/fileHelper';
import { toFormData } from '../utils/formData';
import { sessionExportFilename } from '../utils/sessionFilename';
import {
  EXPORT_COMMERCE_BUNDLE,
  EXPORT_COMMERCE_DATA,
  EXTRACT_COMMERCE_BUNDLE,
  IMPORT_COMMERCE_DATA,
} from '../utils/microservicePaths';

/** The package extension, so a renamed file still tells an operator what it is. */
const PACKAGE_EXTENSION = 'aicap';

/**
 * What a package says about itself, read off the response headers.
 *
 * These are the result, not decoration. `unresolved` is media the source
 * recorded that the package does not carry; `incomplete` is products missing a
 * field the schema requires, which cannot be imported as they stand. Anything
 * above zero means the package is thinner than its source, and a download that
 * reported only "done" would hide exactly what they exist to surface.
 *
 * A header that is not exposed by CORS reads as null rather than 0, and the
 * two must not be conflated: absent means nobody could tell us, which is worth
 * saying out loud rather than reporting as a clean result.
 */
function packageCounts(headers) {
  const read = (name) => {
    const value = headers?.get?.(name);

    return value === null || value === undefined || value === ''
      ? null
      : Number(value);
  };

  return {
    images: read('X-AICA-Media-Images'),
    incomplete: read('X-AICA-Products-Incomplete'),
    partial: read('X-AICA-Products-Partial'),
    pdfs: read('X-AICA-Media-Pdfs'),
    source: headers?.get?.('X-AICA-Media-Source') || null,
    unresolved: read('X-AICA-Media-Unresolved'),
  };
}

function describeCounts(counts) {
  if (counts.images === null && counts.pdfs === null) {
    return 'the package carries media, but the counts were not readable from this origin';
  }

  return `${counts.images ?? 0} image(s), ${counts.pdfs ?? 0} PDF(s)`;
}

/**
 * Moving a dataset in and out of the tool.
 *
 * Four operations, three of them producing a file and one consuming it:
 *
 *   - export JSON      the dataset alone, no media
 *   - export package   the dataset and the media this service holds on disk
 *   - extract package  the same, read back from a live Liferay instance
 *   - import           either form, into the connected target
 *
 * The export and extract halves differ only in cost, so they report the same
 * counts the same way; see docs/architecture/microservice-architecture.md.
 */
export default function useDatasetIO({
  api,
  // The admin screen has no activity log and no generation form, so the three
  // it does not use default rather than being required. Sharing the hook is
  // the point: two copies of the export already disagreed about whether the
  // activity log was written, and a third would have picked its own endpoint.
  addLog = () => {},
  buildPayload = () => ({}),
  dispatch = () => {},
  isGenerating = false,
}) {
  const [isTransferring, setIsTransferring] = useState(false);

  /**
   * Warns rather than congratulates when a package is short.
   *
   * Returns whether it was complete, so a caller can decide what to say; the
   * log lines are written either way, because the person who imports a package
   * is usually not the person who built it.
   */
  const reportCounts = useCallback(
    (counts, what) => {
      const shortfalls = [];

      if (counts.unresolved) {
        shortfalls.push(
          `${counts.unresolved} media item(s) could not be included`
        );
      }

      if (counts.incomplete) {
        shortfalls.push(
          `${counts.incomplete} product(s) are missing a field the schema requires`
        );
      }

      addLog(`${what}: ${describeCounts(counts)}`, 'info');

      if (counts.partial) {
        // Not a shortfall: usually a blank metaTitle on the source, faithfully
        // reproduced. It reads as detail rather than an alarm on purpose.
        addLog(
          `${counts.partial} product(s) are missing optional fields only`,
          'info'
        );
      }

      if (shortfalls.length === 0) return true;

      addLog(
        `⚠ ${what} is thinner than its source: ${shortfalls.join('; ')}`,
        'warning'
      );
      notifyUser(`${what} is incomplete - see the activity log`, 'warning');

      return false;
    },
    [addLog]
  );

  /** The JSON dataset for one session. No media, and no Liferay involved. */
  const exportSession = useCallback(
    async (session) => {
      const sessionId = session?.id || session?.session_id;

      if (!sessionId) return;

      const name = session.name || session.session_name || sessionId;

      try {
        addLog(`Exporting dataset for session: ${name}...`, 'info');

        // The session id is not optional. Without it the endpoint falls
        // through to a cache tier holding products, accounts and orders only -
        // no addresses, warehouses, specifications or media entries - and
        // reports success either way.
        const res = await api.get(
          `${EXPORT_COMMERCE_DATA}?sessionId=${encodeURIComponent(sessionId)}`
        );

        exportJsonFile(res, sessionExportFilename('aica-dataset', name));

        notifyUser('Dataset exported successfully');
        addLog('✓ Dataset exported successfully', 'success');
      } catch (error) {
        console.error('Failed to export dataset:', error);
        addLog(`Failed to export dataset: ${error.message}`, 'error');
        notifyUser('Failed to export dataset', 'danger');
      }
    },
    [api, addLog]
  );

  /** The dataset and the media already on disk. Cheap: no instance is called. */
  const exportPackage = useCallback(
    async (session) => {
      const sessionId = session?.id || session?.session_id;

      if (!sessionId || isTransferring) return;

      const name = session.name || session.session_name || sessionId;

      setIsTransferring(true);

      try {
        addLog(`Building a dataset package for ${name}...`, 'info');

        const { blob, headers } = await api.download(
          `${EXPORT_COMMERCE_BUNDLE}?sessionId=${encodeURIComponent(sessionId)}`
        );

        saveBlobFile(
          blob,
          sessionExportFilename('aica-package', name, {
            extension: PACKAGE_EXTENSION,
          })
        );

        if (reportCounts(packageCounts(headers), 'Dataset package')) {
          notifyUser('Dataset package downloaded');
          addLog('✓ Dataset package downloaded', 'success');
        }
      } catch (error) {
        console.error('Failed to build the dataset package:', error);
        addLog(
          `Failed to build the dataset package: ${error.message}`,
          'error'
        );
        notifyUser('Failed to build the dataset package', 'danger');
      } finally {
        setIsTransferring(false);
      }
    },
    [api, addLog, isTransferring, reportCounts]
  );

  /**
   * The same package, read back from a live instance.
   *
   * `source` is required by the endpoint rather than inferred, so a mistyped
   * session id cannot silently produce an instance-wide package instead.
   */
  const extractPackage = useCallback(
    async ({ session, source = 'instance' } = {}) => {
      if (isTransferring) return;

      const sessionId = session?.id || session?.session_id;

      if (source === 'session' && !sessionId) {
        notifyUser('Choose a session to extract', 'warning');
        return;
      }

      const name = session?.name || session?.session_name || sessionId;

      setIsTransferring(true);

      try {
        addLog(
          source === 'instance'
            ? 'Extracting a dataset package from the connected instance...'
            : `Extracting media for ${name} from the connected instance...`,
          'info'
        );

        const { blob, headers } = await api.download(EXTRACT_COMMERCE_BUNDLE, {
          method: 'POST',
          // The connection is the source here, and this route reads it rather
          // than writing anything.
          body: { ...buildPayload(), source, sessionId },
        });

        saveBlobFile(
          blob,
          sessionExportFilename('aica-extract', name || source, {
            extension: PACKAGE_EXTENSION,
          })
        );

        if (reportCounts(packageCounts(headers), 'Extracted package')) {
          notifyUser('Dataset package extracted');
          addLog('✓ Dataset package extracted', 'success');
        }
      } catch (error) {
        console.error('Failed to extract the dataset package:', error);
        addLog(`Failed to extract: ${error.message}`, 'error');
        notifyUser('Failed to extract the dataset package', 'danger');
      } finally {
        setIsTransferring(false);
      }
    },
    [api, addLog, buildPayload, isTransferring, reportCounts]
  );

  /**
   * Import a dataset or a package into the connected target.
   *
   * This used to parse the file, write it to the browser console and show a
   * success notification, so an operator reasonably believed their data was
   * being imported when nothing had happened (#881).
   *
   * The file goes as multipart, the way the CLI sends it, because a package is
   * a zip and the route detects one by its header rather than by its name. An
   * import is a full workflow run - the same steps as a generate without the
   * generation, so no AI spend, but the same duration and the same places to
   * fail - so the session it returns is tracked and watched rather than
   * reported with a toast.
   */
  const importDataset = useCallback(
    async (event) => {
      const file = event?.target?.files?.[0];

      if (!file) return;

      // Cleared straight away so choosing the same file twice still fires a
      // change event.
      event.target.value = '';

      if (isGenerating) {
        notifyUser(
          'Please wait for the current workflow to finish before importing data.',
          'warning'
        );
        return;
      }

      if (isTransferring) return;

      setIsTransferring(true);

      try {
        addLog(`Importing ${file.name}...`, 'info');

        const response = await api.post(
          IMPORT_COMMERCE_DATA,
          // liferayUrl is mandatory on the write routes, and an import is a
          // write: the payload carries the connection rather than relying on
          // a fallback (#815).
          toFormData(buildPayload(), { importFile: file })
        );

        if (!response?.sessionId) {
          const message = response?.error || 'The import did not start';

          addLog(`Import not started: ${message}`, 'error');
          notifyUser(message, 'danger');
          return;
        }

        dispatch({ type: 'RESET_ALL' });
        dispatch({
          type: 'SET_ACTIVE_SESSION',
          sessionId: response.sessionId,
          flowType: 'import',
        });
        dispatch({ type: 'SET_WORKFLOW_STATUS', status: 'running' });

        addLog(
          `✓ Import started for ${file.name}. Session ID: ${response.sessionId}`,
          'success'
        );
        notifyUser('Dataset import started');
      } catch (error) {
        console.error('Failed to import dataset:', error);
        addLog(`Failed to import dataset: ${error.message}`, 'error');
        notifyUser(`Failed to import dataset: ${error.message}`, 'danger');
      } finally {
        setIsTransferring(false);
      }
    },
    [api, addLog, buildPayload, dispatch, isGenerating, isTransferring]
  );

  return {
    exportPackage,
    exportSession,
    extractPackage,
    importDataset,
    isTransferring,
  };
}
