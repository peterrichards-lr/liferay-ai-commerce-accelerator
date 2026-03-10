export const CORRELATION_ID_HEADER = 'X-Correlation-ID';

// WebSocket Event Types
export const WEB_SOCKET_EVENTS = {
  // Unified Lifecycle Events
  STARTED: 'STARTED',
  PROGRESS: 'PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',

  // Legacy (Keep for backwards compatibility during migration)
  BATCH_COMPLETED: 'batch_completed',
  BATCH_PROGRESS: 'batch_progress',
  BATCH_START: 'batch_start',
  BATCH_FAILED: 'batch_failed',
  ERROR: 'error',
  GENERATION_SESSION_COMPLETE: 'generation_session_complete',
};

// Operational Scopes
export const WS_SCOPE = {
  BATCH: 'batch',
  SESSION: 'session',
  STEP: 'step',
};

// Standardized Operations
export const WS_OPERATION = {
  GENERATE: 'generate',
  DELETE: 'delete',
  PROCESS_IMAGES: 'process-images',
  PROCESS_ATTACHMENTS: 'process-attachments',
};
