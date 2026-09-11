/**
 * What a failed Liferay request actually said, in a form a log line and a
 * user-facing message can both use.
 *
 * `error.message` on a `LiferayRequestError` is the operation's friendly
 * label - "Get Channels Bulk", "Failed to create price entry" - which is the
 * one fact the reader already has. A missing OAuth scope, a 500 and a DNS
 * failure are indistinguishable under it, and #890 cost a promotion the time
 * it took to compare two runs and infer a scope difference from which of them
 * succeeded. The status alone would have named it.
 */

// Long enough for a validation message naming several fields, short enough
// that a log line stays readable.
const MAX_DETAIL = 600;

function readStatus(error) {
  return error?.status ?? error?.statusCode ?? error?.response?.status;
}

function truncate(value) {
  if (value == null) return null;

  const text = typeof value === 'string' ? value : safeStringify(value);

  return text ? text.slice(0, MAX_DETAIL) : null;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Fields to spread into a log call. Only what is present is included, so a
 * plain Error adds nothing and a log line never gains empty keys.
 */
function describeRequestFailure(error) {
  if (!error || typeof error !== 'object') return {};

  const described = {};
  const status = readStatus(error);

  if (status !== undefined) described.status = status;
  if (error.operation) described.operation = error.operation;
  if (error.request?.url) described.requestPath = error.request.url;
  if (error.request?.method) described.requestMethod = error.request.method;
  if (error.networkCode) described.networkCode = error.networkCode;
  if (error.errorReference) described.errorReference = error.errorReference;

  const detail = truncate(error.problem ?? error.response?.data);

  if (detail) described.liferayDetail = detail;

  if (error.userMessage && error.userMessage !== error.message) {
    described.userMessage = error.userMessage;
  }

  return described;
}

/**
 * The same facts as one clause, for a message an operator reads rather than a
 * log a machine indexes. "HTTP 403" is the sentence that ends the
 * investigation; the friendly label is the sentence that starts it.
 */
function summariseRequestFailure(error) {
  if (!error) return 'no error was recorded';

  const status = readStatus(error);
  const title = error.problem?.title || error.problem?.detail;

  if (status !== undefined) {
    return title ? `HTTP ${status}: ${truncate(title)}` : `HTTP ${status}`;
  }

  if (error.networkCode) return error.networkCode;

  return error.message || String(error);
}

/**
 * Whether another attempt could plausibly succeed.
 *
 * Credentials do not become valid on the next call and a rejected payload does
 * not become well-formed, so 401, 403 and every other 4xx that is not 429 are
 * terminal. Anything without a status is unknown rather than transient: this
 * is asked per entity inside a batch, where guessing "retry" repeats a doomed
 * request once per remaining item (#890).
 */
function isTransientRequestFailure(error) {
  const status = readStatus(error);

  if (typeof status === 'number') {
    return status === 408 || status === 429 || status >= 500;
  }

  return ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(
    error?.networkCode ?? error?.code
  );
}

/**
 * Whether a failure condemns every remaining item as well as this one.
 *
 * A rejected price entry is a defect in one SKU; an expired token is a defect
 * in the run. The first should be recorded and stepped over, the second should
 * stop the loop before it asks fifty more times (#890, #892).
 */
function isTerminalAuthFailure(error) {
  const status = readStatus(error);

  return status === 401 || status === 403 || error?.errorType === 'auth_error';
}

module.exports = {
  MAX_DETAIL,
  describeRequestFailure,
  isTerminalAuthFailure,
  isTransientRequestFailure,
  summariseRequestFailure,
};
