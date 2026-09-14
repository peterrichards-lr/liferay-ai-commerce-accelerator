const {
  isLoopbackRequest,
  trustedClientAddress,
} = require('../utils/clientAddress.cjs');
const {
  requestSigningMiddleware,
} = require('../middleware/securityMiddleware.cjs');

/**
 * The loopback exemption, and the header that used to defeat it.
 *
 * `requestSigningMiddleware` lets a local caller skip request signing. It used
 * to decide "local" from `req.ip`, and because `server.cjs` sets
 * `trust proxy: true`, `req.ip` is the leftmost `X-Forwarded-For` entry - set
 * by whoever sent the request. So `X-Forwarded-For: 127.0.0.1` from anywhere
 * skipped signing on the whole v1 API.
 *
 * Measured against a running service before the fix:
 *
 *   POST /api/v1/batch/callback                          -> 202
 *   POST /api/v1/batch/callback  X-Forwarded-For: 1.2.3.4 -> 401
 *
 * which is the same mechanism seen from the other side: the header decided it.
 * See GHSA-qvx5-h4wr-pcfv.
 */
describe('the loopback exemption ignores forwarded headers (GHSA-qvx5-h4wr-pcfv)', () => {
  const request = ({ forwarded, socket }) => ({
    connection: { remoteAddress: socket },
    get: (name) =>
      name.toLowerCase() === 'x-forwarded-for' ? forwarded : undefined,
    // What Express actually computes with `trust proxy` enabled: the LEFTMOST
    // entry of the forwarded chain, not the whole header. Modelled properly so
    // the chain case below is a real test rather than one that passes because
    // a comma made the string stop matching. Present so this fails if anything
    // starts reading it again for an access decision.
    ip: forwarded ? forwarded.split(',')[0].trim() : socket,
    path: '/api/v1/generate/workflow',
    socket: { remoteAddress: socket },
  });

  const runSigning = (req) => {
    let passed = false;
    const res = {
      json: () => res,
      status: () => res,
    };

    requestSigningMiddleware(req, res, () => {
      passed = true;
    });

    return passed;
  };

  it('lets a genuinely local caller through', () => {
    // The exemption exists for the CLI, the tests and the startup probes.
    expect(runSigning(request({ socket: '127.0.0.1' }))).toBe(true);
  });

  it('refuses a remote caller claiming to be local', () => {
    // The bypass. Before the fix this returned true.
    const spoofed = request({ forwarded: '127.0.0.1', socket: '203.0.113.5' });

    expect(spoofed.ip).toBe('127.0.0.1');
    expect(runSigning(spoofed)).toBe(false);
  });

  it('refuses a remote caller even when the header names a chain ending local', () => {
    const spoofed = request({
      forwarded: '127.0.0.1, 10.0.0.1',
      socket: '203.0.113.5',
    });

    expect(runSigning(spoofed)).toBe(false);
  });

  it('accepts the IPv4-mapped form a dual-stack listener reports', () => {
    expect(runSigning(request({ socket: '::ffff:127.0.0.1' }))).toBe(true);
    expect(runSigning(request({ socket: '::1' }))).toBe(true);
  });

  it('fails closed when there is no socket to ask', () => {
    // Not local unless proven local. Defaulting open here would reinstate the
    // bypass for anything that arrives without a socket.
    expect(isLoopbackRequest({})).toBe(false);
    expect(trustedClientAddress({})).toBeNull();
  });

  it('never reads the address from a header', () => {
    // The property that matters, stated directly: whatever the caller sends,
    // the answer comes from the transport.
    const req = request({ forwarded: '127.0.0.1', socket: '198.51.100.9' });

    expect(trustedClientAddress(req)).toBe('198.51.100.9');
  });
});
