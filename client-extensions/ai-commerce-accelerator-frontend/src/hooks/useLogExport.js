import { useCallback } from 'react';
import notifyUser from '../utils/notifications';
import { buildFilename, exportJsonFile } from '../utils/fileHelper';

/**
 * Hook for managing log and system state exports.
 * Useful for sharing the current dashboard state with AI or support.
 */
export default function useLogExport({
  logs,
  progress,
  config,
  generationConfig,
}) {
  const exportLogs = useCallback(() => {
    try {
      const exportData = {
        summary: {
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          activeSessionId: progress.activeSessionId,
        },
        systemStatus: {
          config: {
            liferayUrl: config.liferayUrl,
            microserviceUrl: config.microserviceUrl,
            batchSize: config.batchSize,
            currencyCode: config.currencyCode,
          },
          generationConfig: {
            ...generationConfig,
            customImageFile: generationConfig.customImageFile
              ? '[FILE ATTACHED]'
              : null,
            customPDFFile: generationConfig.customPDFFile
              ? '[FILE ATTACHED]'
              : null,
          },
        },
        progress: {
          products: progress.products,
          accounts: progress.accounts,
          orders: progress.orders,
          images: progress.images,
          pdfs: progress.pdfs,
          warehouses: progress.warehouses,
        },
        activityLogs: logs.map((l) => ({
          time: l.timestamp,
          type: l.type?.toUpperCase(),
          source: l.source,
          message: l.message,
        })),
      };

      const filename = buildFilename('aica-status-logs');
      exportJsonFile(exportData, filename);

      notifyUser('System status and logs exported successfully');
    } catch (error) {
      console.error('Failed to export logs:', error);
      notifyUser('Failed to export logs', 'danger');
    }
  }, [logs, progress, config, generationConfig]);

  return { exportLogs };
}
