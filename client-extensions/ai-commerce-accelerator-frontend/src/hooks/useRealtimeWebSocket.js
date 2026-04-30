import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  WEB_SOCKET_EVENTS as E,
  WS_SCOPE,
  CORRELATION_ID_HEADER,
} from '../utils/sharedConstants';
import { normalizeEntityType } from '../utils/misc';
import { WORKFLOW_STATUS } from '../utils/microservicePaths';

export default function useRealtimeWebSocket({
  enabled,
  microserviceUrl,
  loggingLevel = 'off',
  onLog,
  onProgress,
  onBatchErrorDetails,
  activeSessionId: providedSessionId,
}) {
  const { getCorrelationId, api } = useApp();
  const wsRef = useRef(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(null);

  // Sync internal activeSessionId with provided prop
  useEffect(() => {
    if (providedSessionId && providedSessionId !== activeSessionId) {
      setActiveSessionId(providedSessionId);
    }
  }, [providedSessionId, activeSessionId]);

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

  const hydrateSessionStatus = async (sessionId) => {
    if (!sessionId || !api) return;
    try {
      logDebug(`Hydrating session status for ${sessionId}...`);
      const path = WORKFLOW_STATUS.replace(':sessionId', sessionId);
      const res = await api.get(path);

      if (res?.success && res.progress) {
        logDebug('Received hydration data:', res.progress);

        // Ensure the reducer knows this is the active session
        onProgress?.({
          type: 'SET_ACTIVE_SESSION',
          sessionId,
        });

        // Update each entity's progress
        Object.entries(res.progress).forEach(([entity, data]) => {
          if (data.total > 0) {
            onProgress?.({
              type: 'SET_TOTAL',
              entity,
              total: data.total,
            });
            onProgress?.({
              type: 'SET_COMPLETED',
              entity,
              completed: data.completed,
            });
          }
        });

        onLog?.('Progress bars hydrated from server.', 'debug');
      }
    } catch (err) {
      logError('Failed to hydrate session status', err);
    }
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

      // Attempt to hydrate status if we have a session
      if (activeSessionId) {
        hydrateSessionStatus(activeSessionId);
      }

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

      // Dispatch global event for debugging/logging
      window.dispatchEvent(
        new CustomEvent('liferay-ai-ws-event', { detail: data })
      );

      const entityType = normalizeEntityType(data.entityType);
      const {
        scope,
        type,
        processedCount,
        totalCount,
        error,
        sessionId,
        batchId,
      } = data;

      // Track the active session ID locally
      if (sessionId && sessionId !== activeSessionId) {
        setActiveSessionId(sessionId);
      }

      // We prioritize sessionId for identifying the current local task context
      // ignoring correlationId which is prone to being lost in proxy/batch layers
      logDebug(`WS Event for Session ${sessionId}: ${scope}/${type}`, data);

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
              onProgress({
                type: 'SET_TOTAL',
                entity: entityType,
                total: totalCount || 0,
              });
            }
          } else if (scope === WS_SCOPE.BATCH) {
            // New: Track individual batch starts within a step
            if (onProgress && entityType && batchId) {
              onProgress({
                type: 'UPDATE_BATCH',
                entity: entityType,
                batchId,
                completed: 0,
                total: totalCount || 0,
              });
            }
          }
          break;

        case E.PROGRESS:
          if (onProgress && entityType) {
            if (scope === WS_SCOPE.STEP) {
              // Direct absolute step progress (e.g. from post-processing or internal logic)
              onProgress({
                type: 'SET_COMPLETED',
                entity: entityType,
                completed: processedCount || 0,
              });
            } else if (scope === WS_SCOPE.BATCH && batchId) {
              // Granular batch progress - update batch then re-sum entity total
              onProgress({
                type: 'UPDATE_BATCH',
                entity: entityType,
                batchId,
                completed: processedCount || 0,
                total: totalCount,
              });
            }
          }
          break;

        case E.COMPLETED:
          if (scope === WS_SCOPE.SESSION) {
            onLog?.('Workflow session completed.', 'success');
            onProgress?.({ type: 'SET_ACTIVE_SESSION', sessionId: null });
            setActiveSessionId(null);
          } else if (scope === WS_SCOPE.STEP) {
            onLog?.(`Step completed: ${entityType}`, 'success');
            if (onProgress && entityType) {
              // Mark as 100% complete
              onProgress({
                type: 'SET_COMPLETED_TO_TOTAL',
                entity: entityType,
              });
            }
          } else if (scope === WS_SCOPE.BATCH && batchId) {
            // Batch finished - mark it done and re-sum
            const successCount =
              data.successCount ?? data.details?.successCount ?? totalCount;
            const failureCount = data.failureCount ?? data.details?.failureCount ?? 0;

            onProgress({
              type: 'UPDATE_BATCH',
              entity: entityType,
              batchId,
              completed: successCount,
              total: totalCount,
            });

            if (failureCount > 0) {
              onLog?.(
                `Batch finished with ${failureCount} failure(s): ${batchId}`,
                'warning'
              );
              if (onProgress && entityType) {
                onProgress({
                  type: 'ADD_ERRORS',
                  entity: entityType,
                  errors: data.details?.errors || [
                    { message: `Batch had ${failureCount} failures`, batchId },
                  ],
                });
              }
            } else {
              onLog?.(
                `Batch completed: ${batchId} (+${successCount})`,
                'success'
              );
            }
          }
          break;

        case E.FAILED:
          const errorMessage = error?.message || error || 'Unknown error';
          if (scope === WS_SCOPE.SESSION) {
            onLog?.(`Workflow failed: ${errorMessage}`, 'error');
            onProgress?.({ type: 'SET_ACTIVE_SESSION', sessionId: null });
            setActiveSessionId(null);
          } else {
            onLog?.(
              `${scope} failed: ${entityType} — ${errorMessage}`,
              'error'
            );
            if (onProgress && entityType) {
              onProgress({
                type: 'ADD_ERRORS',
                entity: entityType,
                errors: { message: errorMessage, batchId: data.batchId },
              });
            }
          }
          break;

        case E.BATCH_ERROR_DETAILS:
          if (onBatchErrorDetails) {
            onBatchErrorDetails(data);
          }
          break;

        case E.ERROR:
          onLog?.(`System error: ${data.message || 'Unknown error'}`, 'error');
          break;

        // Backward compatibility for legacy events
        case E.BATCH_PROGRESS:
          if (onProgress && entityType) {
            onProgress({
              type: 'SET_COMPLETED',
              entity: entityType,
              completed: processedCount,
            });
          }
          break;

        case E.BATCH_COMPLETED:
          if (onProgress && entityType) {
            onProgress({
              type: 'INCR_COMPLETED',
              entity: entityType,
              amount: data.successCount,
            });
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
  }, [enabled, microserviceUrl, providedSessionId]);

  return { wsRef, wsConnected, reconnect, ping };
}
