import { useCallback, useEffect, useRef, useState } from 'react';
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
  const activeSessionIdRef = useRef(null);
  const activeFlowTypeRef = useRef(null);
  const connectRef = useRef(null);

  // Sync internal activeSessionIdRef with provided prop
  useEffect(() => {
    if (providedSessionId && providedSessionId !== activeSessionIdRef.current) {
      activeSessionIdRef.current = providedSessionId;
    }
  }, [providedSessionId]);

  // Use refs for callbacks to prevent reconnection loops when they change identity
  const callbacksRef = useRef({ onLog, onProgress, onBatchErrorDetails, api });
  useEffect(() => {
    callbacksRef.current = { onLog, onProgress, onBatchErrorDetails, api };
  }, [onLog, onProgress, onBatchErrorDetails, api]);

  const backoffRef = useRef(1000);
  const reconnectTimerRef = useRef(null);

  const logInfo = useCallback(
    (...args) => {
      if (loggingLevel === 'basic' || loggingLevel === 'debug')
        console.info('🟦 WS:', ...args);
    },
    [loggingLevel]
  );
  const logDebug = useCallback(
    (...args) => {
      if (loggingLevel === 'debug') console.debug('⚙️ WS:', ...args);
    },
    [loggingLevel]
  );
  const logWarn = useCallback(
    (...args) => {
      if (loggingLevel !== 'off') console.warn('🟨 WS:', ...args);
    },
    [loggingLevel]
  );
  const logError = useCallback(
    (...args) => {
      if (loggingLevel !== 'off') console.error('🟥 WS:', ...args);
    },
    [loggingLevel]
  );

  const hydrateSessionStatus = useCallback(
    async (sessionId) => {
      const {
        api: currentApi,
        onProgress: currentOnProgress,
        onLog: currentOnLog,
      } = callbacksRef.current;
      if (!sessionId || !currentApi) return;
      try {
        logDebug(`Hydrating session status for ${sessionId}...`);
        const path = WORKFLOW_STATUS.replace(':sessionId', sessionId);
        const res = await currentApi.get(path);

        if (res?.success && res.progress) {
          logDebug('Received hydration data:', res.progress);

          // If the session is finished, clear it from active state
          if (res.status === 'COMPLETED' || res.status === 'FAILED') {
            currentOnProgress?.({
              type: 'SET_ACTIVE_SESSION',
              sessionId: null,
              flowType: res.flowType,
            });
            activeSessionIdRef.current = null;
          } else {
            // Ensure the reducer knows this is the active session
            currentOnProgress?.({
              type: 'SET_ACTIVE_SESSION',
              sessionId,
              flowType: res.flowType,
            });
            activeFlowTypeRef.current = res.flowType;

            // Restore step-based progress if available
            if (typeof res.totalSteps === 'number' && res.totalSteps > 0) {
              currentOnProgress?.({
                type: 'SET_TOTAL_STEPS',
                total: res.totalSteps,
              });
            }

            if (typeof res.completedSteps === 'number') {
              // We need a SET_COMPLETED_STEPS or similar, but since we
              // only have INCREMENT, let's add a reset and then apply
              // For now, let's just dispatch a new action type we'll add
              currentOnProgress?.({
                type: 'HYDRATE_STEPS',
                completed: res.completedSteps,
              });
            }
          }

          // Update each entity's progress
          Object.entries(res.progress).forEach(([entity, data]) => {
            if (data.total > 0) {
              currentOnProgress?.({
                type: 'SET_TOTAL',
                entity,
                total: data.total,
              });
              currentOnProgress?.({
                type: 'SET_COMPLETED',
                entity,
                completed: data.completed,
              });
            }
          });

          currentOnLog?.('Progress bars hydrated from server.', 'debug');
        }
      } catch (err) {
        logError('Failed to hydrate session status', err);
      }
    },
    [logDebug, logError]
  );

  const cleanupSocket = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
      } catch {
        /* ignore */
      }
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
    setWsConnected(false);
  }, []);

  const connect = useCallback(() => {
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
    const { onLog: currentOnLog } = callbacksRef.current;

    if (loggingLevel === 'debug') {
      currentOnLog?.(`Connecting to WebSocket: ${trimmed}...`, 'debug');
    }

    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    const connectionTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        logWarn('⏰ WebSocket connection timeout');
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        const { onLog: currentOnLog } = callbacksRef.current;
        currentOnLog?.(`WebSocket timed out at ${trimmed}.`, 'warning');
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectionTimeout);
      backoffRef.current = 1000;
      setWsConnected(true);
      const { onLog: currentOnLog } = callbacksRef.current;
      currentOnLog?.('WebSocket connected.', 'success');
      logInfo('✅ Connection established');

      // Attempt to hydrate status if we have a session
      if (activeSessionIdRef.current) {
        hydrateSessionStatus(activeSessionIdRef.current);
      }

      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        /* ignore */
      }
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!data || typeof data !== 'object') return;

      const {
        onProgress: currentOnProgress,
        onLog: currentOnLog,
        onBatchErrorDetails: currentOnBatchErrorDetails,
      } = callbacksRef.current;

      if (data.type === 'pong') {
        if (loggingLevel === 'debug') {
          currentOnLog?.('WebSocket Pong received.', 'debug');
        }
        return;
      }

      // Dispatch global event for debugging/logging
      window.dispatchEvent(
        new CustomEvent('liferay-ai-ws-event', { detail: data })
      );

      const entityType = normalizeEntityType(data.entityType);
      const { scope, error, sessionId, details } = data;
      const flowType =
        details?.flowType || data.flowType || activeFlowTypeRef.current;
      const type = data.type || data.status; // Fallback to status if type is missing

      const processedCount = data.processedCount ?? data.completedCount;
      const totalCount = data.totalCount ?? data.totalItems;
      const batchId = data.batchId ?? data.batchERC;

      // Track the active session ID locally
      if (sessionId && sessionId !== activeSessionIdRef.current) {
        activeSessionIdRef.current = sessionId;
      }

      logDebug(`WS Event for Session ${sessionId}: ${scope}/${type}`, data);

      switch (type) {
        case E.STARTED:
          if (scope === WS_SCOPE.SESSION) {
            const isDelete =
              flowType === 'delete' || data.operation === 'delete';
            currentOnLog?.(
              `${isDelete ? 'Deletion' : 'Workflow'} started: ${
                data.operation || 'process'
              }`,
              'info'
            );

            // Notify reducer about the active session and its type
            currentOnProgress?.({
              type: 'SET_ACTIVE_SESSION',
              sessionId,
              flowType: isDelete ? 'delete' : 'generate',
            });
            activeFlowTypeRef.current = isDelete ? 'delete' : 'generate';

            if (isDelete) {
              const totalSteps = data.totalSteps || details?.totalSteps;
              if (totalSteps) {
                currentOnProgress?.({
                  type: 'SET_TOTAL_STEPS',
                  total: totalSteps,
                });
              }
              return;
            }

            // Trigger RESET_ALL with initial totals if provided
            if (currentOnProgress && data.totals) {
              currentOnProgress({ type: 'RESET_ALL', totals: data.totals });
            }
          } else if (scope === WS_SCOPE.STEP) {
            const op = data.operation || 'process';
            currentOnLog?.(
              `Step started: ${
                entityType.charAt(0).toUpperCase() + entityType.slice(1)
              } (${op})`,
              'info'
            );
            if (
              currentOnProgress &&
              entityType &&
              typeof totalCount === 'number' &&
              totalCount > 0
            ) {
              currentOnProgress({
                type: 'SET_TOTAL',
                entity: entityType,
                total: totalCount,
              });
            }
          } else if (scope === WS_SCOPE.BATCH) {
            currentOnLog?.(
              `Batch started: ${entityType} (${batchId}) — ${totalCount} items`,
              'debug'
            );
            if (currentOnProgress && entityType && batchId) {
              currentOnProgress({
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
          if (currentOnProgress && entityType) {
            if (scope === WS_SCOPE.STEP) {
              currentOnProgress({
                type: 'SET_COMPLETED',
                entity: entityType,
                completed: processedCount || 0,
              });
              if (typeof totalCount === 'number') {
                currentOnProgress({
                  type: 'SET_TOTAL',
                  entity: entityType,
                  total: totalCount,
                });
              }
            } else if (scope === WS_SCOPE.BATCH && batchId) {
              // Log batch progress for visibility, but dedupe/throttle if needed
              // (currently just logging all for debugging as requested)
              if (processedCount % 5 === 0 || processedCount === totalCount) {
                currentOnLog?.(
                  `Batch progress: ${entityType} — ${processedCount}/${totalCount}`,
                  'debug'
                );
              }

              currentOnProgress({
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
            const isDelete = flowType === 'delete';
            currentOnLog?.(
              `${isDelete ? 'Deletion' : 'Workflow'} session completed.`,
              'success'
            );

            currentOnProgress?.({
              type: 'SET_ACTIVE_SESSION',
              sessionId: null,
              flowType: isDelete ? 'delete' : 'generate',
            });

            if (isDelete) {
              currentOnProgress?.({
                type: 'SET_WORKFLOW_STATUS',
                status: 'completed',
              });
              return;
            }

            currentOnProgress?.({
              type: 'SET_WORKFLOW_STATUS',
              status: 'completed',
            });
            activeSessionIdRef.current = null;
          } else if (scope === WS_SCOPE.STEP) {
            const isDelete = activeFlowTypeRef.current === 'delete';
            currentOnLog?.(
              `Step completed: ${
                entityType.charAt(0).toUpperCase() + entityType.slice(1)
              }`,
              'success'
            );

            if (currentOnProgress) {
              currentOnProgress({ type: 'INCREMENT_STEPS' });
            }

            if (currentOnProgress && entityType) {
              // Mark as 100% complete
              currentOnProgress({
                type: 'SET_COMPLETED_TO_TOTAL',
                entity: entityType,
              });
            }
          } else if (scope === WS_SCOPE.BATCH && batchId) {
            // Batch finished - mark it done and re-sum
            const successCount =
              data.successCount ?? data.details?.successCount ?? totalCount;
            const failureCount =
              data.failureCount ?? data.details?.failureCount ?? 0;

            currentOnProgress?.({
              type: 'UPDATE_BATCH',
              entity: entityType,
              batchId,
              completed: successCount,
              total: totalCount,
            });

            if (failureCount > 0) {
              currentOnLog?.(
                `Batch finished with ${failureCount} failure(s): ${batchId}`,
                'warning'
              );
              if (currentOnProgress && entityType) {
                currentOnProgress({
                  type: 'ADD_ERRORS',
                  entity: entityType,
                  errors: data.details?.errors || [
                    { message: `Batch had ${failureCount} failures`, batchId },
                  ],
                });
              }
            } else {
              currentOnLog?.(
                `Batch completed: ${batchId} (+${successCount})`,
                'success'
              );
            }
          }
          break;

        case E.FAILED: {
          const errorMessage = error?.message || error || 'Unknown error';
          if (scope === WS_SCOPE.SESSION) {
            const isDelete = flowType === 'delete';
            currentOnLog?.(
              `${isDelete ? 'Deletion' : 'Workflow'} failed: ${errorMessage}`,
              'error'
            );

            currentOnProgress?.({
              type: 'SET_ACTIVE_SESSION',
              sessionId: null,
              flowType: isDelete ? 'delete' : 'generate',
            });

            if (isDelete) {
              currentOnProgress?.({
                type: 'SET_WORKFLOW_STATUS',
                status: 'failed',
              });
              return;
            }

            currentOnProgress?.({
              type: 'SET_WORKFLOW_STATUS',
              status: 'failed',
            });
            activeSessionIdRef.current = null;
          } else {
            currentOnLog?.(
              `${scope} failed: ${entityType} — ${errorMessage}`,
              'error'
            );
            if (currentOnProgress && entityType) {
              currentOnProgress({
                type: 'ADD_ERRORS',
                entity: entityType,
                errors: { message: errorMessage, batchId: data.batchId },
              });
            }
          }
          break;
        }

        case E.BATCH_ERROR_DETAILS:
          if (currentOnBatchErrorDetails) {
            currentOnBatchErrorDetails(data);
          }
          break;

        case E.ERROR:
          currentOnLog?.(
            `System error: ${data.message || 'Unknown error'}`,
            'error'
          );
          break;

        // Backward compatibility for legacy events
        case E.BATCH_PROGRESS:
          if (currentOnProgress && entityType) {
            currentOnProgress({
              type: 'SET_COMPLETED',
              entity: entityType,
              completed: processedCount,
            });
          }
          break;

        case E.BATCH_COMPLETED:
          if (currentOnProgress && entityType) {
            currentOnProgress({
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

      const delayAmount = Math.min(backoffRef.current, 10000);
      reconnectTimerRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 10000);
        // Use ref to call the latest version of connect without lexical loop
        if (connectRef.current) {
          connectRef.current();
        }
      }, delayAmount);
    };
  }, [
    enabled,
    microserviceUrl,
    getCorrelationId,
    logDebug,
    logWarn,
    logInfo,
    hydrateSessionStatus,
    logError,
    loggingLevel,
  ]);

  // Final check to update the connectRef
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const reconnect = useCallback(() => {
    cleanupSocket();
    connect();
  }, [cleanupSocket, connect]);

  const ping = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const { onLog: currentOnLog } = callbacksRef.current;
        if (loggingLevel === 'debug') {
          currentOnLog?.('Sending WebSocket Ping...', 'debug');
        }
        ws.send(JSON.stringify({ type: 'ping' }));
        return true;
      } catch {
        /* ignore */
      }
    }
    reconnect();
    return false;
  }, [reconnect, loggingLevel]);

  useEffect(() => {
    if (enabled && microserviceUrl) {
      connect();
    }
    return () => cleanupSocket();
  }, [enabled, microserviceUrl, cleanupSocket, connect]);

  return { wsRef, wsConnected, reconnect, ping };
}
