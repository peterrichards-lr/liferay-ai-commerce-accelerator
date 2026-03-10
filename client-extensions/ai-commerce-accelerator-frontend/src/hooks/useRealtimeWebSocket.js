import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  WEB_SOCKET_EVENTS as E,
  WS_SCOPE,
  CORRELATION_ID_HEADER,
} from '../utils/sharedConstants';
import { normalizeEntityType } from '../utils/misc';

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
    if (!enabled || !microserviceUrl) return;
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const trimmed = microserviceUrl.replace(/\/$/, '');
    const wsUrl = trimmed.replace(/^http/, 'ws');
    const cid = getCorrelationId?.();

    const url = new URL(wsUrl);
    if (cid) url.searchParams.set(CORRELATION_ID_HEADER, cid);

    logDebug('🔗 Preparing WebSocket connection', { url: url.toString() });

    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        logWarn('⏰ WebSocket connection timeout');
        try {
          ws.close();
        } catch {}
        onLog?.(`WebSocket timed out at ${trimmed}.`, 'warning');
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      backoffRef.current = 1000;
      setWsConnected(true);
      onLog?.('WebSocket connected.', 'success');
      logInfo('✅ Connection established');
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch {}
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!data || typeof data !== 'object') return;
      if (data.type === 'pong') return;

      const entityType = normalizeEntityType(data.entityType);
      const { scope, type, processedCount, totalCount, error } = data;

      logDebug(`WS Event: ${scope}/${type}`, data);

      switch (type) {
        case E.STARTED:
          if (scope === WS_SCOPE.SESSION) {
            onLog?.(`Workflow started: ${data.operation || 'process'}`, 'info');
            // Trigger RESET_ALL with initial totals if provided
            if (onProgress && data.totals) {
              onProgress({ type: 'RESET_ALL', totals: data.totals });
            }
          } else if (scope === WS_SCOPE.STEP) {
            onLog?.(`Step started: ${entityType}`, 'info');
            if (onProgress && entityType) {
              onProgress({ type: 'SET_TOTAL', entity: entityType, total: totalCount || 0 });
            }
          }
          break;

        case E.PROGRESS:
          if (scope === WS_SCOPE.BATCH || scope === WS_SCOPE.STEP) {
            if (onProgress && entityType) {
              onProgress({ 
                type: 'SET_COMPLETED', 
                entity: entityType, 
                completed: processedCount || 0 
              });
            }
          }
          break;

        case E.COMPLETED:
          if (scope === WS_SCOPE.SESSION) {
            onLog?.('Workflow session completed.', 'success');
          } else if (scope === WS_SCOPE.STEP) {
            onLog?.(`Step completed: ${entityType}`, 'success');
            if (onProgress && entityType) {
              // Mark as 100% complete
              onProgress({ type: 'SET_COMPLETED_TO_TOTAL', entity: entityType });
            }
          }
          break;

        case E.FAILED:
          const errorMessage = error?.message || error || 'Unknown error';
          if (scope === WS_SCOPE.SESSION) {
            onLog?.(`Workflow failed: ${errorMessage}`, 'error');
          } else {
            onLog?.(`${scope} failed: ${entityType} — ${errorMessage}`, 'error');
            if (onProgress && entityType) {
              onProgress({ 
                type: 'ADD_ERRORS', 
                entity: entityType, 
                errors: { message: errorMessage, batchId: data.batchId } 
              });
            }
          }
          break;

        // Backward compatibility for legacy events
        case E.BATCH_PROGRESS:
          if (onProgress && entityType) {
            onProgress({ type: 'SET_COMPLETED', entity: entityType, completed: processedCount });
          }
          break;

        case E.BATCH_COMPLETED:
          if (onProgress && entityType) {
            onProgress({ type: 'INCR_COMPLETED', entity: entityType, amount: data.successCount });
          }
          break;

        default:
          break;
      }
    };

    ws.onerror = (e) => {
      clearTimeout(connectionTimeout);
      setWsConnected(false);
      logError('Socket error event', e);
    };

    ws.onclose = () => {
      clearTimeout(connectionTimeout);
      setWsConnected(false);
      if (!enabled) return;

      const delay = Math.min(backoffRef.current, 10000);
      reconnectTimerRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 10000);
        connect();
      }, delay);
    };
  };

  const reconnect = () => {
    cleanupSocket();
    connect();
  };

  const ping = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
        return true;
      } catch {}
    }
    reconnect();
    return false;
  };

  useEffect(() => {
    cleanupSocket();
    if (enabled && microserviceUrl) connect();
    return () => cleanupSocket();
  }, [enabled, microserviceUrl]);

  return { wsRef, wsConnected, reconnect, ping };
}
