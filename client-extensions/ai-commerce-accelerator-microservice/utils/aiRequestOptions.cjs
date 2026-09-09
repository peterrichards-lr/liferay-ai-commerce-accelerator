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

/**
 * The output cap sent when the configuration does not name one.
 *
 * It is deliberately the only place the number is written in the microservice.
 * It used to be written as 4000 in the configuration seed and 16384 in each
 * provider, and the two were reconciled at request time by comparing the
 * configured value against 4000 and substituting 16384 when they matched. That
 * made a configured 4000 mean 16384 and raising the panel from 4000 to 8000
 * halve the real cap, because 8000 was no longer the magic value (#823).
 *
 * 16384 rather than 4000 because 16384 is what every run has actually been
 * sent, so it is the cap the product is validated at. A chunk of ten entities
 * of structured JSON does not fit in 4000, and a truncated response is not
 * degraded output - both providers turn `stop_reason: max_tokens` and
 * `finish_reason: length` into a failed step.
 */
const DEFAULT_MAX_TOKENS = 16384;

/** Anything non-positive means "no explicit timeout", not "time out at once". */
function requestOptions(options = {}) {
  const timeout = Number(options.requestTimeoutMs);

  return Number.isFinite(timeout) && timeout > 0 ? { timeout } : {};
}

/**
 * A configured cap is sent as configured; only absence falls back.
 *
 * Zero, negative and unparseable values count as absence rather than being
 * forwarded, because `max_tokens: 0` is rejected by both providers and an
 * operator who cleared the field meant "use the default", not "fail every
 * request". Liferay returns configuration as strings, hence the coercion.
 */
function resolveMaxTokens(configured) {
  const value = Number(configured ?? DEFAULT_MAX_TOKENS);

  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_MAX_TOKENS;
}

module.exports = { DEFAULT_MAX_TOKENS, requestOptions, resolveMaxTokens };
