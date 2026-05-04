import { useCallback } from 'react';
import notifyUser from '../utils/notifications';
import { buildFilename, exportJsonFile } from '../utils/fileHelper';
import { EXPORT_COMMERCE_DATA } from '../utils/microservicePaths';

export default function useDatasetIO({ api, addLog, isGenerating }) {
  const exportSession = useCallback(
    async (session) => {
      if (!session?.id) return;

      try {
        addLog(
          `Exporting dataset for session: ${session.name || session.id}...`,
          'info'
        );

        // We can pass the sessionId to the export endpoint
        // Note: The export endpoint currently doesn't take a sessionId,
        // but it could be updated to fetch that specific session's context.
        // For now, we fetch from the general export which we updated to use the latest completed.
        // To be truly robust, we'll update the endpoint to accept a sessionId.
        const res = await api.get(
          `${EXPORT_COMMERCE_DATA}?sessionId=${session.id}`
        );

        const filename = buildFilename(
          `aica-dataset-${session.name || session.id}`
        );
        exportJsonFile(res, filename);

        notifyUser('Dataset exported successfully');
        addLog('✓ Dataset exported successfully', 'success');
      } catch (error) {
        console.error('Failed to export dataset:', error);
        addLog('Failed to export dataset: ' + error.message, 'error');
        notifyUser('Failed to export dataset', 'danger');
      }
    },
    [api, addLog]
  );

  const importDataset = useCallback(
    (event) => {
      const file = event.target.files[0];
      if (!file) return;

      if (isGenerating) {
        notifyUser(
          'Please wait for current workflow to finish before importing data.',
          'warning'
        );
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const importedData = JSON.parse(e.target.result);
          addLog(
            'Dataset import selected. (Note: Full population from local JSON is planned for a future update)',
            'info'
          );
          console.log('Imported Dataset:', importedData);
          notifyUser('Dataset import selected');
        } catch {
          notifyUser('Failed to import dataset. Invalid JSON file.', 'danger');
        }
      };

      reader.readAsText(file);
      event.target.value = '';
    },
    [isGenerating, addLog]
  );

  return { exportSession, importDataset };
}
