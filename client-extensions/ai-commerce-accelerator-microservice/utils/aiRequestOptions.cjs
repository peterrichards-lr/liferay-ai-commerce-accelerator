/**
 * Per-request options for an AI provider SDK.
 *
 * The timeout goes on the request rather than the client because clients are
 * cached per API key for the life of the process: a client built with one
 * timeout would keep it after the configuration changed, and the operator's
 * setting would appear to work while doing nothing.
 *
 * It appeared to work already. `getRuntimeAIConfig` resolves
 * `requestTimeoutMs` - 60000 by default, settable in the AI configuration -
 * and returns it in the runtime object, which is spread into the provider's
 * options. Neither provider ever read it, so the SDK's own default applied
 * instead and the setting did nothing at all (#762).
 *
 * Both the Anthropic and OpenAI SDKs take `{ timeout }` as a second argument
 * to a create call, in milliseconds.
 */

/** Anything non-positive means "no explicit timeout", not "time out at once". */
function requestOptions(options = {}) {
  const timeout = Number(options.requestTimeoutMs);

  return Number.isFinite(timeout) && timeout > 0 ? { timeout } : {};
}

module.exports = { requestOptions };
