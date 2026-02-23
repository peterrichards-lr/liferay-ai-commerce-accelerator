import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  STARTED,
  PROGRESS,
  COMPLETED,
  FAILED,
  BATCH_COMPLETED,
  BATCH_ERROR_DETAILS,
  BATCH_FAILED,
  BATCH_PROGRESS,
  BATCH_START,
  CONNECTED,
  ERROR,
  GENERATION_SESSION_COMPLETE,
} from '../utils/webSocket';
import { normalizeEntityType } from '../utils/misc';
import { CORRELATION_ID_HEADER } from '../utils/sharedConstants';

export default function useRealtimeWebSocket({
  enabled,
  microserviceUrl,
  loggingLevel = 'off',
  onLog,
  onProgress,
  onBatchErrorDetails,
}) {
  const { getCorrelationId } = useApp();
  const wsRef = useRef(null);
  const [wsConnected, setWsConnected] = useState(false);

  const seenBatchIdsRef = useRef(new Set());
  const backoffRef = useRef(1000);
  const reconnectTimerRef = useRef(null);

  const logInfo = (...args) => {
    if (loggingLevel === 'basic' || loggingLevel === 'debug')
      console.info('🟦 WS:', ...args);
  };
  const logDebug = (...args) => {
    if (loggingLevel === 'debug') console.debug('⚙️ WS:', ...args);
  };
  const logWarn = (...args) => {
    if (loggingLevel !== 'off') console.warn('🟨 WS:', ...args);
  };
  const logError = (...args) => {
    if (loggingLevel !== 'off') console.error('🟥 WS:', ...args);
  };

  const toStr = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'object') {
      if (typeof v.id === 'string') return v.id;
      if (typeof v.batchId === 'string') return v.batchId;
      try {
        return JSON.stringify(v);
      } catch {}
    }
    return String(v);
  };

  const shortId = (id) => {
    const s = toStr(id);
    return s ? s.slice(-6) : '∅';
  };

  const tag = (entityType, batchId, operation) => {
    const et = entityType ?? 'unknown';
    const op = operation ? `/${String(operation).toLowerCase()}` : '';
    const isNumeric = /^[0-9]+$/.test(batchId);
    return `${et}${op}#${isNumeric ? shortId(batchId) : batchId}`;
  };

  const extractOperation = (payload) =>
    String(
      payload.operation ||
        payload.mode ||
        payload.details?.operation ||
        payload.details?.mode ||
        ''
    ).toLowerCase();

  const cleanupSocket = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.onopen =
          wsRef.current.onmessage =
          wsRef.current.onerror =
          wsRef.current.onclose =
            null;
      } catch {}
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    setWsConnected(false);
  };

  const connect = () => {
    if (!enabled || !microserviceUrl) {
      logDebug('connect() skipped — enabled or microserviceUrl not set', {
        enabled,
        microserviceUrl,
      });
      return;
    }
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      logDebug('connect() aborted — socket already OPEN/CONNECTING', {
        readyState: wsRef.current.readyState,
      });
      return;
    }

    seenBatchIdsRef.current = new Set();

    const trimmed = microserviceUrl.replace(/\/$/, '');
    const wsUrl = trimmed.replace(/^http/, 'ws');
    const cid = getCorrelationId?.();

    const url = new URL(wsUrl);
    if (cid) url.searchParams.set(CORRELATION_ID_HEADER, cid);

    logDebug('🔗 Preparing WebSocket connection', {
      url: url.toString(),
      correlationId: cid,
    });

    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        logWarn('⏰ WebSocket connection timeout');
        try {
          ws.close();
        } catch {}
        onLog?.(
          `WebSocket timed out. Is the microservice up at ${trimmed}?`,
          'warning'
        );
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      backoffRef.current = 1000;
      setWsConnected(true);
      onLog?.('WebSocket connection established successfully.', 'success');
      logInfo('✅ Connection established');
      try {
        ws.send(
          JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() })
        );
      } catch (e) {
        logWarn('Ping on open failed', e);
      }
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
        console.log('Raw WebSocket data received:', data);
      } catch {
        onLog?.('WebSocket received invalid JSON message.', 'error');
        logError('Invalid JSON message payload', event.data);
        return;
      }

      if (!data || typeof data !== 'object') return;
      if (data.type === 'pong') {
        logDebug('Received pong');
        return;
      }

      const entityType = normalizeEntityType(
        data.entityType || data.details?.entityType
      );
      const bId = data.batchId || data.details?.batchId;
      const op = extractOperation(data);

      if (
        bId &&
        (data.type === BATCH_COMPLETED || data.type === BATCH_FAILED || data.type === COMPLETED || data.type === FAILED)
      ) {
        if (data.scope === 'batch' || !data.scope) {
          if (seenBatchIdsRef.current.has(bId)) {
            logDebug(`Duplicate ${data.type} ignored`, { batchId: bId });
            return;
          }
          seenBatchIdsRef.current.add(bId);
          logDebug('Tracking new batch event', { type: data.type, batchId: bId });
        }
      }

      const coerceNum = (v) => (Number.isFinite(v) ? v : undefined);
      const extractCounts = (payload) => {
        const success =
          coerceNum(payload.successCount) ??
          coerceNum(payload.processedCount) ??
          coerceNum(payload.details?.processedCount) ??
          0;

        const failures =
          coerceNum(payload.failureCount) ??
          coerceNum(payload.errorCount) ??
          coerceNum(payload.details?.failureCount) ??
          coerceNum(payload.details?.errorCount) ??
          0;

        let total =
          coerceNum(payload.totalCount) ??
          coerceNum(payload.details?.totalCount) ??
          success + failures ??
          0;

        if (!Number.isFinite(total) || total < success) {
          total = success + failures;
        }
        return { success, failures, total };
      };

      switch (data.type) {
        case STARTED: {
          const total = data.totalCount ?? data.details?.totalCount;
          logDebug(`${data.scope?.toUpperCase() || 'UNKNOWN'} STARTED received`, {
            scope: data.scope,
            entityType,
            total,
            raw: data,
          });

          if (data.scope === 'session') {
            onLog?.(`Session started: ${data.details?.flowType || 'unknown'}`, 'info');
          } else if (data.scope === 'step' || data.scope === 'batch') {
            onLog?.(
              total != null
                ? `${data.scope} started: ${entityType} — total ${total}`
                : `${data.scope} started: ${entityType}`,
              'info'
            );

            if (onProgress && entityType !== 'unknown') {
              onProgress((prev) => ({
                ...prev,
                [entityType]: {
                  ...prev[entityType],
                  total: total ?? prev[entityType]?.total,
                  completed: 0,
                },
              }));
            }
          }
          break;
        }

        case PROGRESS: {
          const { processedCount, totalCount } = data;
          logDebug(`${data.scope?.toUpperCase() || 'UNKNOWN'} PROGRESS received`, {
            scope: data.scope,
            entityType,
            processedCount,
            totalCount,
            raw: data,
          });

          if (data.scope === 'batch' || data.scope === 'step') {
            if (onProgress && entityType !== 'unknown') {
              onProgress((prev) => {
                const cur = prev?.[entityType] || {
                  total: 0,
                  completed: 0,
                  errors: [],
                };
                return {
                  ...prev,
                  [entityType]: {
                    ...cur,
                    total: totalCount ?? cur.total,
                    completed: processedCount ?? cur.completed,
                  },
                };
              });
            }
          }
          break;
        }

        case COMPLETED: {
          const { success, total } = extractCounts(data);
          logDebug(`${data.scope?.toUpperCase() || 'UNKNOWN'} COMPLETED received`, {
            scope: data.scope,
            entityType,
            successCount: success,
            totalCount: total,
            raw: data,
          });

          if (data.scope === 'session') {
            onLog?.('Workflow session completed.', 'success');
          } else if (data.scope === 'step' || data.scope === 'batch') {
            onLog?.(
              total != null
                ? `${data.scope} complete: ${entityType} — +${success}`
                : `${data.scope} complete: ${entityType}`,
              'success'
            );

            if (onProgress && entityType !== 'unknown') {
              onProgress((prev) => {
                const cur = prev?.[entityType] || {
                  total: 0,
                  completed: 0,
                  errors: [],
                };
                const nextCompleted = data.scope === 'batch' ? (cur.completed + (success ?? 0)) : (total ?? success ?? cur.total);
                return {
                  ...prev,
                  [entityType]: {
                    ...cur,
                    total: total ?? cur.total,
                    completed: Math.min(
                      nextCompleted,
                      total || cur.total || Infinity
                    ),
                  },
                };
              });
            }
          }
          break;
        }

        case FAILED: {
          const { failures, total } = extractCounts(data);
          logError(`${data.scope?.toUpperCase() || 'UNKNOWN'} FAILED received`, {
            scope: data.scope,
            entityType,
            failureCount: failures,
            raw: data,
          });

          if (data.scope === 'session') {
            onLog?.(`Session failed: ${data.error || 'Unknown error'}`, 'error');
          } else {
            onLog?.(
              `${data.scope} failed: ${entityType} — errors: +${failures}`,
              'error'
            );

            if (onBatchErrorDetails && data.scope === 'batch') {
              onBatchErrorDetails({
                batchId: bId,
                importTask: { errorMessage: data.error },
                errorReport: data.details?.errors,
              });
            }

            if (onProgress && entityType !== 'unknown') {
              onProgress((prev) => {
                const cur = prev?.[entityType] || {
                  total: 0,
                  completed: 0,
                  errors: [],
                };
                const nextCompleted = cur.completed + (failures ?? 0);
                const addErrors =
                  failures > 0
                    ? Array.from({ length: failures }, () => ({
                        batchId: bId,
                        op,
                      }))
                    : [];
                return {
                  ...prev,
                  [entityType]: {
                    ...cur,
                    total: total ?? cur.total,
                    completed: Math.min(
                      nextCompleted,
                      total || cur.total || Infinity
                    ),
                    errors: [...cur.errors, ...addErrors],
                  },
                };
              });
            }
          }
          break;
        }

        // Legacy event handlers (keeping for backward compatibility)
        case BATCH_START: {
          const total =
            data?.details?.totalItems ?? data?.details?.totalCount ?? undefined;

          logDebug('BATCH_START received', {
            entityType,
            batchId: bId,
            total,
            raw: data,
          });
          onLog?.(
            total != null
              ? `Batch started ${tag(entityType, bId, op)} — total ${total}`
              : `Batch started ${tag(entityType, bId, op)}`,
            'info'
          );

          if (onProgress && entityType !== 'unknown') {
            onProgress((prev) => ({
              ...prev,
              [entityType]: {
                ...prev[entityType],
                total: total ?? prev[entityType]?.total,
                completed: 0,
              },
            }));
          }
          break;
        }

        case BATCH_PROGRESS: {
          const { processedCount, totalItems } = data;

          logDebug('BATCH_PROGRESS received', {
            entityType,
            operation: op,
            processedCount,
            totalItems,
            raw: data,
          });

          onLog?.(
            `Batch progress ${tag(
              entityType,
              data.batchId,
              op
            )} — ${processedCount}/${totalItems}`,
            'info'
          );

          if (onProgress && entityType !== 'unknown') {
            onProgress((prev) => {
              const cur = prev?.[entityType] || {
                total: 0,
                completed: 0,
                errors: [],
              };
              return {
                ...prev,
                [entityType]: {
                  ...cur,
                  total: totalItems ?? cur.total,
                  completed: processedCount ?? cur.completed,
                },
              };
            });
          }

          break;
        }

        case BATCH_COMPLETED: {
          const { success, total } = extractCounts(data);
          const activityOnly = !!(data.details && data.details.activityOnly);

          logDebug('BATCH_COMPLETED received', {
            entityType,
            batchId: bId,
            successCount: success,
            totalCount: total,
            operation: op || '(none)',
            activityOnly,
            raw: data,
          });

          onLog?.(
            total != null
              ? `Batch complete ${tag(entityType, bId, op)} — +${success}`
              : `Batch complete ${tag(entityType, bId, op)}`,
            'success'
          );

          if (!activityOnly && onProgress && entityType !== 'unknown') {
            onProgress((prev) => {
              const cur = prev?.[entityType] || {
                total: 0,
                completed: 0,
                errors: [],
              };
              const nextCompleted = cur.completed + (success ?? 0);
              return {
                ...prev,
                [entityType]: {
                  ...cur,
                  total: total ?? cur.total,
                  completed: Math.min(
                    nextCompleted,
                    total || cur.total || Infinity
                  ),
                },
              };
            });
          }

          break;
        }

        case BATCH_FAILED: {
          const failures = data.failureCount ?? data.details?.errorCount ?? 0;
          const total = data.details?.totalCount ?? undefined;

          logDebug('BATCH_FAILED received', {
            entityType,
            batchId: bId,
            failureCount: failures,
            totalCount: total,
            raw: data,
          });

          onLog?.(
            `Batch failed ${tag(entityType, bId, op)} — errors: +${failures}`,
            'error'
          );

          if (onBatchErrorDetails) {
            onBatchErrorDetails({
              batchId: bId,
              importTask: { errorMessage: data.details?.error },
              errorReport: data.details?.errors,
            });
          }

          if (onProgress && entityType !== 'unknown') {
            onProgress((prev) => {
              const cur = prev?.[entityType] || {
                total: 0,
                completed: 0,
                errors: [],
              };
              const nextCompleted = cur.completed + (failures ?? 0);
              const addErrors =
                failures > 0
                  ? Array.from({ length: failures }, () => ({
                      batchId: bId,
                      op,
                    }))
                  : [];
              return {
                ...prev,
                [entityType]: {
                  ...cur,
                  total: total ?? cur.total,
                  completed: Math.min(
                    nextCompleted,
                    total || cur.total || Infinity
                  ),
                  errors: [...cur.errors, ...addErrors],
                },
              };
            });
          }

          break;
        }

        case BATCH_ERROR_DETAILS: {
          logDebug('BATCH_ERROR_DETAILS received', { raw: data });
          onBatchErrorDetails?.(data);
          break;
        }

        case CONNECTED: {
          logDebug('CONNECTED received', { raw: data });
          onLog?.('Web socket Connected', 'info');
          break;
        }

        case GENERATION_SESSION_COMPLETE: {
          logDebug('GENERATION_SESSION_COMPLETE received', { raw: data });
          onLog?.(
            'Generation session completed — triggering post processing.',
            'info'
          );
          onProgress?.({ kind: 'session', status: 'completed', data });
          break;
        }

        case ERROR: {
          logError('ERROR received', { raw: data });
          const errorMessage = data?.details?.message || data?.message || 'Unknown error';
          const errorRef = data?.errorReference || data?.details?.errorReference;
          const message = errorRef
            ? `Error: ${errorMessage} (Ref: ${errorRef})`
            : `Error: ${errorMessage}`;
          onLog?.(message, 'error');

          if (data.batchId && onBatchErrorDetails) {
            onBatchErrorDetails({
              batchId: data.batchId,
              importTask: { errorMessage: errorMessage },
              errorReport: data.details?.errors,
            });
          }
          break;
        }

        default: {
          logWarn('Unrecognized WS message type', {
            type: data.type,
            raw: data,
          });
        }
      }
    };

    ws.onerror = (e) => {
      clearTimeout(connectionTimeout);
      setWsConnected(false);
      onLog?.('WebSocket error. Check the microservice is reachable. Will continue to retry.', 'error');
      logError('Socket error event', e?.message || e);
    };

    ws.onclose = (event) => {
      clearTimeout(connectionTimeout);
      setWsConnected(false);
      if (!enabled) return;

      const delay = Math.min(backoffRef.current, 10000);
      logWarn(`🔌 WS closed (code ${event.code}) — retrying in ${delay}ms`);
      reconnectTimerRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 10000);
        logDebug('Reconnecting with backoff', {
          backoffMs: backoffRef.current,
        });
        connect();
      }, delay);
    };
  };

  const reconnect = () => {
    logInfo('🔄 Forcing WebSocket reconnect()');
    cleanupSocket();
    connect();
  };

  const ping = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(
          JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() })
        );
        onLog?.('Ping sent to WebSocket server.', 'info');
        logDebug('Ping sent');
        return true;
      } catch (err) {
        logWarn('Ping failed; will reconnect', err);
      }
    }
    reconnect();
    return false;
  };

  useEffect(() => {
    cleanupSocket();
    if (enabled && microserviceUrl) connect();
    return () => cleanupSocket();
  }, [enabled, microserviceUrl, loggingLevel]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (
          !wsConnected ||
          !wsRef.current ||
          wsRef.current.readyState !== WebSocket.OPEN
        ) {
          onLog?.('Tab visible — reconnecting WebSocket if needed…', 'info');
          reconnect();
        } else {
          ping();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [wsConnected, reconnect, ping]);

  return { wsRef, wsConnected, reconnect, ping };
}
