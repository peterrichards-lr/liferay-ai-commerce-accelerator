import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  BATCH_COMPLETED,
  BATCH_FAILED,
  GENERATION_SESSION_COMPLETE,
  PROGRESS_UPDATE,
} from '../utils/webSocket';
import { normalizeEntityType } from '../utils/misc';
import { CORRELATION_ID_HEADER } from '../utils/sharedConstants';

export default function useRealtimeWebSocket({
  enabled,
  microserviceUrl,
  loggingLevel = 'off', // 'off' | 'basic' | 'debug'
  onLog, // (msg: string, level: 'info'|'success'|'warning'|'error') => void
  onProgress, // (payload) => void
}) {
  const { getCorrelationId } = useApp?.() || {};
  const wsRef = useRef(null);
  const [wsConnected, setWsConnected] = useState(false);

  const seenBatchIdsRef = useRef(new Set()); // duplicate suppression per-connection
  const backoffRef = useRef(1000); // start 1s, double up to 10s
  const reconnectTimerRef = useRef(null);

  const log = (...args) => {
    if (loggingLevel !== 'off') console.log(...args);
  };
  const debug = (...args) => {
    if (loggingLevel === 'debug') console.debug(...args);
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
    if (!enabled || !microserviceUrl) {
      debug('WS connect skipped — enabled/microserviceUrl not set');
      return;
    }
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      debug('WS already OPEN/CONNECTING — skipping connect()');
      return;
    }

    seenBatchIdsRef.current = new Set();

    const trimmed = microserviceUrl.replace(/\/$/, '');
    const wsUrl = trimmed.replace(/^http/, 'ws');
    const cid = getCorrelationId?.();

    const url = new URL(wsUrl);
    if (cid) url.searchParams.set(CORRELATION_ID_HEADER, cid);

    log('🔗 Creating WebSocket:', url.toString());
    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        console.warn('⏰ WebSocket connection timeout');
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
      try {
        ws.send(
          JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() })
        );
      } catch {}
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        onLog?.('WebSocket received invalid JSON message.', 'error');
        return;
      }

      if (!data || typeof data !== 'object') return;
      if (data.type === 'pong') return;

      const entityType = normalizeEntityType(
        data.entityType || data.details?.entityType
      );

      const bId = data.batchId || data.details?.batchId;
      if (
        bId &&
        (data.type === BATCH_COMPLETED || data.type === BATCH_FAILED)
      ) {
        if (seenBatchIdsRef.current.has(bId)) {
          debug(`🟡 Dropping duplicate ${data.type} for batchId=${bId}`);
          return;
        }
        seenBatchIdsRef.current.add(bId);
      }

      switch (data.type) {
        case BATCH_COMPLETED: {
          onLog?.(
            `Batch complete (${entityType}) — ${
              data.successCount ?? data.details?.processedCount ?? 0
            }/${data.details?.totalCount ?? 0}`,
            'success'
          );
          onProgress?.({
            kind: 'batch',
            status: 'completed',
            entityType,
            data,
          });
          break;
        }
        case BATCH_FAILED: {
          onLog?.(
            `Batch failed (${entityType}) — errors: ${
              data.failureCount ?? data.details?.errorCount ?? 0
            }`,
            'error'
          );
          onProgress?.({
            kind: 'batch',
            status: 'failed',
            entityType,
            data,
          });
          break;
        }
        case GENERATION_SESSION_COMPLETE: {
          onLog?.(
            'Generation session completed — triggering post processing.',
            'info'
          );
          onProgress?.({
            kind: 'session',
            status: 'completed',
            data,
          });
          break;
        }
        case PROGRESS_UPDATE: {
          onProgress?.({
            kind: 'progress',
            entityType,
            data,
          });
          break;
        }
        default: {
          debug('WS message:', data);
        }
      }
    };

    ws.onerror = (e) => {
      clearTimeout(connectionTimeout);
      setWsConnected(false);
      onLog?.('WebSocket error. Check the microservice is reachable.', 'error');
      debug('WS error:', e?.message || e);
    };

    ws.onclose = (event) => {
      clearTimeout(connectionTimeout);
      setWsConnected(false);
      if (!enabled) return;

      const delay = Math.min(backoffRef.current, 10000); // cap at 10s
      debug(`🔌 WS closed (code ${event.code}). Retrying in ${delay}ms…`);
      reconnectTimerRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 10000);
        connect();
      }, delay);
    };
  };

  const reconnect = () => {
    log('🔄 Forcing WebSocket reconnect()');
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
        return true;
      } catch {
        // fall through to reconnect
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
          onLog?.(
            'Tab visible — checking WebSocket and reconnecting if needed…',
            'info'
          );
          reconnect();
        } else {
          ping();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [wsConnected]);

  return { wsRef, wsConnected, reconnect, ping };
}
