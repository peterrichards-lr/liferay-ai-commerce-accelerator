import { useCallback } from 'react';
import notifyUser from '../utils/notifications';
import { exportJsonFile } from '../utils/fileHelper';
import { normaliseType } from './useActivityLog';
import { sessionExportFilename } from '../utils/sessionFilename';

/**
 * Says, in the export itself, whether it holds the whole record (#811).
 *
 * The activity log is a bounded buffer, so a long run exports its tail and
 * used to say nothing about the rest. Anyone counting entries in the file -
 * "25 skipped price entries", "no warning was logged" - was reading a floor
 * as a total and an eviction as an absence.
 *
 * Reported whether or not anything was dropped, for the reason the media
 * bundle reports `unresolved: 0`: a block that only appears when something
 * went wrong cannot be distinguished from a block nobody wrote.
 */
function buildCoverage(stats, includedCount) {
  if (!stats) {
    return {
      complete: null,
      dropped: null,
      droppedByType: {},
      generated: null,
      included: includedCount,
      maxEntries: null,
    };
  }

  return {
    complete: stats.dropped === 0,
    dropped: stats.dropped,
    droppedByType: stats.droppedByType,
    generated: stats.generated,
    included: stats.included,
    maxEntries: stats.maxEntries,
  };
}

/**
 * The marker inside `activityLogs` itself.
 *
 * The coverage block is the machine-readable half; this is for the reader who
 * scrolls to the end of the log and needs to know the record stops there
 * rather than the run doing so. Entries are newest first, so it goes last.
 * `TRUNCATED` is not one of the log's own types, so it cannot be mistaken for
 * something the run emitted or double-counted as a warning.
 */
function truncationEntry(coverage) {
  const byType = Object.entries(coverage.droppedByType)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${type} ${count}`)
    .join(', ');

  return {
    time: null,
    type: 'TRUNCATED',
    source: 'activity-log',
    message:
      `${coverage.dropped} earlier entries were discarded before this point ` +
      `(buffer holds ${coverage.maxEntries}; the run produced ` +
      `${coverage.generated}). Discarded by type: ${byType}. Any count taken ` +
      `from this log is a floor, not a total, and an entry missing from it ` +
      `is not evidence it was never logged.`,
  };
}

/**
 * Hook for managing log and system state exports.
 * Useful for sharing the current dashboard state with AI or support.
 */
export default function useLogExport({
  logs,
  getLogStats,
  progress,
  config,
  generationConfig,
}) {
  const exportLogs = useCallback(() => {
    try {
      const isDelete = progress.activeFlowType === 'delete';
      const sessionName = generationConfig?.sessionName;

      const entries = logs.map((l) => ({
        time: l.timestamp,
        type: normaliseType(l.type),
        source: l.source,
        message: l.message,
      }));

      const activityLogCoverage = buildCoverage(
        typeof getLogStats === 'function' ? getLogStats() : null,
        entries.length
      );

      if (activityLogCoverage.dropped > 0) {
        entries.push(truncationEntry(activityLogCoverage));
      }

      const exportData = {
        summary: {
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          activeSessionId: progress.activeSessionId,
          sessionName: sessionName || null,
          flowType: progress.activeFlowType || 'generate',
          workflowStatus: progress.workflowStatus,
        },
        systemStatus: {
          config: {
            liferayUrl: config.liferayUrl,
            microserviceUrl: config.microserviceUrl,
            batchSize: config.batchSize,
            currencyCode: config.currencyCode,
          },
          // Only relevant for generation
          ...(isDelete
            ? {}
            : {
                generationConfig: {
                  ...generationConfig,
                  customImageFile: generationConfig.customImageFile
                    ? '[FILE ATTACHED]'
                    : null,
                  customPDFFile: generationConfig.customPDFFile
                    ? '[FILE ATTACHED]'
                    : null,
                },
              }),
        },
        progress: isDelete
          ? {
              totalSteps: progress.totalSteps,
              completedSteps: progress.completedSteps,
              details: {
                products: progress.products,
                accounts: progress.accounts,
                orders: progress.orders,
                warehouses: progress.warehouses,
                images: progress.images,
                pdfs: progress.pdfs,
                pricing: {
                  priceLists: progress.priceLists,
                  promotions: progress.promotions,
                },
              },
            }
          : {
              products: progress.products,
              accounts: progress.accounts,
              orders: progress.orders,
              images: progress.images,
              pdfs: progress.pdfs,
              warehouses: progress.warehouses,
            },
        activityLogs: entries,
        activityLogCoverage,
      };

      const filename = sessionExportFilename(
        `aica-logs-${progress.activeFlowType || 'generate'}`,
        sessionName
      );
      exportJsonFile(exportData, filename);

      notifyUser('System status and logs exported successfully');
    } catch (error) {
      console.error('Failed to export logs:', error);
      notifyUser('Failed to export logs', 'danger');
    }
  }, [logs, getLogStats, progress, config, generationConfig]);

  return { exportLogs };
}
