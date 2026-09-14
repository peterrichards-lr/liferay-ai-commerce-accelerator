/**
 * The address a request actually arrived from, for decisions that must not be
 * influenced by the caller.
 *
 * `server.cjs` sets `trust proxy: true`, so Express derives `req.ip` from the
 * leftmost entry of `X-Forwarded-For`. That is the right answer for logging and
 * diagnosis - it names the client a proxy saw - and the wrong answer for
 * anything that grants access, because the header is set by whoever sent the
 * request.
 *
 * `requestSigningMiddleware` exempted loopback callers from request signing and
 * decided loopback from `req.ip`, so `X-Forwarded-For: 127.0.0.1` skipped
 * signing on the whole v1 API. `ipAllowlistMiddleware` read the header outright,
 * and the per-client rate limiter keyed on `req.ip`, so a caller could evade it
 * by varying a header. See GHSA-qvx5-h4wr-pcfv.
 *
 * The socket address is the transport's own answer and cannot be set by the
 * client, so it is what those three now use. Logging is deliberately left on
 * `req.ip`: there, the forwarded value is the useful one and being able to
 * influence it costs nothing.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The peer address of the connection, normalised.
 *
 * Never consults a header. Returns `null` when the socket is gone - a caller
 * deciding access must treat that as "not local" rather than defaulting open.
 */
function trustedClientAddress(req) {
  const address =
    req?.socket?.remoteAddress || req?.connection?.remoteAddress || null;

  return address ? String(address) : null;
}

/**
 * Whether the request came from this machine over loopback.
 *
 * An IPv4-mapped IPv6 address (`::ffff:127.0.0.1`) is how a dual-stack listener
 * reports a v4 loopback client, so it counts.
 */
function isLoopbackRequest(req) {
  const address = trustedClientAddress(req);

  return address !== null && LOOPBACK.has(address);
}

module.exports = { LOOPBACK, isLoopbackRequest, trustedClientAddress };
