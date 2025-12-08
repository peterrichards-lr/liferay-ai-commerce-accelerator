import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
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

      if (
        bId &&
        (data.type === BATCH_COMPLETED || data.type === BATCH_FAILED)
      ) {
        if (seenBatchIdsRef.current.has(bId)) {
          logDebug(`Duplicate ${data.type} ignored`, { batchId: bId });
          return;
        }
        seenBatchIdsRef.current.add(bId);
        logDebug('Tracking new batch event', { type: data.type, batchId: bId });
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
        case BATCH_START: {
          const op = extractOperation(data);
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
          break;
        }

        case BATCH_PROGRESS: {
          const op = extractOperation(data);
          logDebug('BATCH_PROGRESS received', {
            entityType,
            batchId: bId,
            raw: data,
          });
          onLog?.(`Batch progress ${tag(entityType, bId, op)}`, 'info');

          if (
            (op === 'process-images' || op === 'process-attachments') &&
            onProgress
          ) {
            onProgress((prev) => {
              const cur = prev?.[entityType] || {
                total: 0,
                completed: 0,
                errors: [],
              };
              const nextCompleted = cur.completed + (data.processedCount ?? 0);
              return {
                ...prev,
                [entityType]: {
                  ...cur,
                  total: cur.total || 0,
                  completed: Math.min(
                    nextCompleted,
                    cur.total || Infinity
                  ),
                },
              };
            });
          }
          break;
        }

        case BATCH_COMPLETED: {
          const { success, total } = extractCounts(data);
          const op = extractOperation(data);
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

          if (
            (op === 'generate' ||
              op === 'process-images' ||
              op === 'process-attachments') &&
            !activityOnly &&
            onProgress
          ) {
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
                  total: cur.total || total || 0,
                  completed: Math.min(
                    nextCompleted,
                    cur.total || total || Infinity
                  ),
                },
              };
            });
          }

          break;
        }

        case BATCH_FAILED: {
          const op = extractOperation(data);
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

          if (
            (op === 'generate' ||
              op === 'process-images' ||
              op === 'process-attachments') &&
            onProgress
          ) {
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
                  total: cur.total || 0,
                  completed: Math.min(
                    nextCompleted,
                    cur.total || Infinity
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
          onLog?.(`Error reported - ${data?.details?.message}`, 'error');
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
      onLog?.('WebSocket error. Check the microservice is reachable.', 'error');
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
