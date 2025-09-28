import { useEffect, useRef, useState } from 'react';

const clampToTotal = (total, n) =>
  Math.max(0, Math.min(Number.isFinite(total) ? total : n, n));

const normalizeEntityType = (t) => {
  const s = String(t || '').toLowerCase();
  if (!s) return null;
  if (['product', 'products'].includes(s)) return 'products';
  if (['account', 'accounts', 'customer', 'customers', 'users'].includes(s))
    return 'accounts';
  if (['order', 'orders'].includes(s)) return 'orders';
  if (['image', 'images', 'picture', 'pictures', 'media'].includes(s))
    return 'images';
  if (['pdf', 'pdfs', 'document', 'documents'].includes(s)) return 'pdfs';
  return s; // fallback: let it flow if you’ve added custom buckets
};

export default function useRealtimeWebSocket({
  enabled, // boolean: connectionEstablished && !!microserviceUrl
  microserviceUrl, // string
  loggingLevel = 'off', // 'off' | 'info' | 'verbose'
  onLog, // function(message, type)
  onProgress, // React setState for progress
}) {
  const wsRef = useRef(null);
  const [wsConnected, setWsConnected] = useState(false);
  const seenBatchIdsRef = useRef(new Set());

  // unmount cleanup guard
  useEffect(() => {
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const effectId =
      loggingLevel !== 'off' ? Math.random().toString(36).substring(7) : null;

    const log = (...args) => {
      if (loggingLevel !== 'off') console.log(...args);
    };

    if (!enabled || !microserviceUrl) {
      log(
        'ℹ️ WebSocket connection skipped [' +
          effectId +
          '] - prerequisites not met'
      );
      return;
    }

    // If already healthy, skip
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      log(
        'ℹ️ WebSocket already healthy, skipping connection [' + effectId + ']'
      );
      return;
    }

    // Cleanup if not healthy
    if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
      log(
        '🔄 WebSocket effect cleanup [' +
          effectId +
          '] - dependency change or unmount'
      );
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
      setWsConnected(false);
    }

    const trimmed = microserviceUrl?.replace(/\/$/, '');
    const wsUrl = trimmed.replace(/^http/, 'ws');

    log('🔗 Attempting WebSocket connection [' + effectId + ']:', {
      wsUrl,
      microserviceUrl: trimmed,
    });

    try {
      log('🔗 Creating new WebSocket [' + effectId + ']:', {
        wsUrl,
        microserviceUrl: trimmed,
      });
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // 10s connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          console.warn('⏰ WebSocket connection timeout [' + effectId + ']');
          ws.close();
          onLog?.(
            `WebSocket connection timed out. Check if microservice is running on ${trimmed}`,
            'warning'
          );
        }
      }, 10000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        log('✅ WebSocket connected [' + effectId + ']:', {
          url: wsUrl,
          readyState: ws.readyState,
          protocol: ws.protocol,
          extensions: ws.extensions,
        });
        setWsConnected(true);
        onLog?.('WebSocket connection established successfully.', 'success');

        // ping
        try {
          ws.send(
            JSON.stringify({
              type: 'ping',
              timestamp: new Date().toISOString(),
            })
          );
          if (loggingLevel === 'verbose')
            log('📤 Sent ping to WebSocket server [' + effectId + ']');
        } catch (e) {
          console.warn('Failed to send ping:', e);
        }
      };

      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);

          if (loggingLevel === 'verbose') {
            log('📨 WebSocket message received [' + effectId + ']:', {
              messageType: data.type,
              timestamp: data.timestamp || new Date().toISOString(),
              batchId: data.batchId,
              hasData: !!data,
              dataKeys: Object.keys(data),
              fullMessage: data,
            });
          } else if (loggingLevel === 'info') {
            log(
              '📨 WebSocket message [' + effectId + ']:',
              data.type,
              data.batchId ? `(Batch: ${data.batchId})` : ''
            );
          }

          if (data.type === 'batch_completed' && data.batchId) {
            if (seenBatchIdsRef.current.has(data.batchId)) return; // drop duplicate
            seenBatchIdsRef.current.add(data.batchId);
          }

          // control messages
          if (data.type === 'pong') return;
          if (data.type === 'connected') {
            onLog?.('Connected to real-time updates', 'success');
            return;
          }
          if (data.type === 'generation_session_complete') {
            onLog?.(
              '✓ All batches completed - starting image and PDF processing...',
              'success'
            );
            return;
          }

          // helper to update counts (preserves original semantics)
          const updateProgressCounts = (
            entityType,
            successCount,
            failureCount
          ) => {
            onProgress?.((prev) => {
              const bucket = entityType; // already normalized earlier
              const current = prev[bucket] || { completed: 0, errors: [] };
              const total = current.total ?? Infinity;

              let nextCompleted;

              switch (bucket) {
                case 'images':
                case 'pdfs':
                case 'accounts':
                  // Absolute (some services emit a final count or we may set it via HTTP fallback)
                  nextCompleted = Math.max(
                    current.completed || 0,
                    successCount || 0
                  );
                  break;

                default:
                  // Incremental (products/orders batches usually come as deltas)
                  nextCompleted =
                    (current.completed || 0) + (successCount || 0);
                  break;
              }

              nextCompleted = clampToTotal(total, nextCompleted);

              return {
                ...prev,
                [bucket]: {
                  ...current,
                  completed: nextCompleted,
                  errors: [
                    ...(current.errors || []),
                    ...(failureCount
                      ? ['batch failures: ' + failureCount]
                      : []),
                    ...(data.errors || []),
                  ],
                },
              };
            });
          };

          const entityKey = normalizeEntityType(data.entityType);

          // mirror your original switch
          switch (data.type) {
            case 'batch_started':
              onLog?.(
                `⏳ Batch started: ${data.batchId} (${entityKey}) - ${data.totalItems} items`,
                'info'
              );
              onProgress?.((prev) => {
                const current = prev[entityKey] || {
                  total: 0,
                  completed: 0,
                  errors: [],
                };
                return {
                  ...prev,
                  [entityKey]: {
                    ...current,
                    total: (current.total || 0) + data.totalItems,
                    errors: current.errors || [],
                  },
                };
              });
              break;

            case 'batch_progress':
              onLog?.(
                `⏳ Batch progress: ${data.batchId} (${entityKey}) - ${data.completedCount}/${data.totalItems} (${data.progress}%)`,
                'info'
              );
              onProgress?.((prev) => ({
                ...prev,
                [entityKey]: {
                  ...prev[entityKey],
                  completed: data.completedCount,
                },
              }));
              break;

            case 'batch_completed':
              onLog?.(
                `✅ Batch completed: ${data.batchId} (${entityKey}) - ${
                  data.successCount || 0
                } items processed`,
                'success'
              );
              updateProgressCounts(
                entityKey,
                data.successCount || 0,
                data.failureCount || 0
              );
              break;

            case 'session_completed':
              onLog?.(
                `🎉 All batches completed for ${entityKey} - starting post-processing...`,
                'success'
              );
              break;

            case 'post_processing_started':
              onLog?.(
                `📎 Starting post-processing for images and PDFs...`,
                'info'
              );
              break;

            case 'post_processing_progress':
              onLog?.(
                `📎 Post-processing progress: ${data.data.processedCount}/${data.data.totalCount} (${data.data.progress}%)`,
                'info'
              );
              break;

            case 'post_processing_completed': {
              const errorMsg =
                data.data.errorCount > 0
                  ? ` with ${data.data.errorCount} errors`
                  : '';
              onLog?.(
                `✅ Post-processing completed: ${data.data.processedCount}/${data.data.totalCount} products${errorMsg}`,
                data.data.errorCount > 0 ? 'warning' : 'success'
              );
              break;
            }

            default:
              if (loggingLevel !== 'off')
                log(
                  'ℹ️ Unhandled WebSocket message type [' + effectId + ']:',
                  data.type,
                  data
                );
          }
        } catch (parseError) {
          if (loggingLevel !== 'off')
            console.error(
              '❌ WebSocket message parse error [' + effectId + ']:',
              parseError,
              'Raw data:',
              event.data
            );
          onLog?.('WebSocket received invalid message format.', 'error');
        }
      };

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        if (loggingLevel !== 'off') {
          console.error('❌ WebSocket error [' + effectId + ']:', {
            error,
            url: wsUrl,
            readyState: ws.readyState,
            timestamp: new Date().toISOString(),
          });
        }
        setWsConnected(false);
        onLog?.(
          `WebSocket connection error: Unable to connect to ${trimmed}. Please check if the microservice is running.`,
          'error'
        );
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        if (loggingLevel !== 'off') {
          console.log('🔌 WebSocket disconnected [' + effectId + ']:', {
            code: event.code,
            reason: event.reason || 'No reason provided',
            wasClean: event.wasClean,
            timestamp: new Date().toISOString(),
          });
        }
        setWsConnected(false);
        if (event.code !== 1000) {
          onLog?.(
            'WebSocket connection lost. Updates may be delayed.',
            'warning'
          );
        } else if (event.code === 1000 && loggingLevel !== 'off') {
          console.log('ℹ️ WebSocket disconnected cleanly.');
        }
      };
    } catch (err) {
      if (loggingLevel !== 'off')
        console.error(
          '❌ Failed to create WebSocket connection [' + effectId + ']:',
          err
        );
      setWsConnected(false);
      onLog?.('Failed to establish WebSocket connection.', 'error');
      wsRef.current = null;
    }

    // cleanup
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        if (loggingLevel !== 'off')
          console.log('🧹 Cleaning up WebSocket connection [' + effectId + ']');
        wsRef.current.close(1000, 'Component unmounting');
      }
    };
  }, [enabled, microserviceUrl, loggingLevel, onLog, onProgress, wsConnected]);

  return { wsRef, wsConnected };
}
