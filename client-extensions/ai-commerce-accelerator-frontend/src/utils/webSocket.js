const BATCH_COMPLETED = 'batch_completed';
const BATCH_FAILED = 'batch_failed';
const BATCH_PROGRESS = 'batch_progress';
const BATCH_START = 'batch_start';
const GENERATION_SESSION_COMPLETE = 'generation_session_complete';
const POSTPROC_COMPLETED = 'post_processing_completed';
const POSTPROC_PROGRESS = 'post_processing_progress';
const POSTPROC_STARTED = 'post_processing_started';
const PROGRESS_UPDATE = 'progress_update';
const SESSION_COMPLETE = 'session_completed';

/** The connection is not yet open. */
const CONNECTING = 0;
/** The connection is open and ready to communicate. */
const OPEN = 1;
/** The connection is in the process of closing. */
const CLOSING = 2;
/** The connection is closed. */
const CLOSED = 3;

const enumValue = (name) => Object.freeze({ toString: () => name });

const WebSocketConnection = Object.freeze({
  CONNECTING: enumValue('WebSocketConnection.CONNECTING'),
  OPEN: enumValue('WebSocketConnection.OPEN'),
  CLOSING: enumValue('WebSocketConnection.CLOSING'),
  CLOSED: enumValue('WebSocketConnection.CLOSED'),
});

export {
  BATCH_COMPLETED,
  BATCH_FAILED,
  BATCH_PROGRESS,
  BATCH_START,
  GENERATION_SESSION_COMPLETE,
  POSTPROC_COMPLETED,
  POSTPROC_PROGRESS,
  POSTPROC_STARTED,
  PROGRESS_UPDATE,
  SESSION_COMPLETE,
  WebSocketConnection,
};
