const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The microservice is reached through the proxy, never a published port.
 *
 * Three rounds of this chased a port that does not exist. First the lookup
 * asked a `-sidecar` container that has never existed (#1099). Then it asked
 * the right container, which answered nothing. A run against a node finally
 * listed every container and settled it:
 *
 *   aica-e2e                                       8000/tcp, 8080/tcp, …
 *   aica-e2e-ai-commerce-accelerator-microservice  (nothing)
 *   aica-e2e-db                                    5432/tcp
 *   liferay-proxy-global                           0.0.0.0:80->80, 0.0.0.0:443->443
 *
 * Nothing publishes to the host except the proxy. So `http://localhost:<port>`
 * could never have worked, for any port, on a node or on this host - and
 * `find_free_port` was inventing one for an address that was wrong in kind,
 * not merely in value.
 *
 * The route that does exist is the one the script already requires: Phase 1
 * fails the run if `ai-commerce-accelerator-microservice.$TARGET_HOST` does not
 * resolve, and the workflow puts it in /etc/hosts. On a node, 443 reaches the
 * proxy through the tunnel (#1087), so one URL serves both.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const source = fs.readFileSync(SCRIPT, 'utf8');

function hostUrl({ noSsl = 0, portSuffix = '' } = {}) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.startsWith('host_url() {'));
  const end = lines.findIndex((l, i) => i > start && l === '}');

  const script = [
    `NO_SSL=${noSsl}`,
    `SSL_PORT_SUFFIX='${portSuffix}'`,
    'TARGET_HOST=aica-e2e.demo',
    lines.slice(start, end + 1).join('\n'),
    'host_url "ai-commerce-accelerator-microservice.${TARGET_HOST}"',
  ].join('\n');

  return execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
}

describe('the microservice URL goes through the proxy', () => {
  it('uses the subdomain the script already requires', () => {
    // Phase 1 fails the run if this host does not resolve, so the address is
    // already guaranteed by the time anything needs it.
    expect(source).toContain(
      'host_url "ai-commerce-accelerator-microservice.${TARGET_HOST}"'
    );
    expect(hostUrl()).toBe(
      'https://ai-commerce-accelerator-microservice.aica-e2e.demo'
    );
  });

  it('never points at localhost with a port', () => {
    // The shape that was wrong in kind: nothing is published to the host.
    expect(source).not.toMatch(/AICA_MICROSERVICE_URL="http:\/\/localhost:/);
    expect(source).not.toMatch(/host\.docker\.internal:\$\{/);
  });

  it('gives Liferay the same address it gives Playwright', () => {
    // The callback is made from inside the node; the proxy subdomain is the
    // one address that resolves from both sides.
    expect(source).toContain(
      'export LIFERAY_BATCH_CALLBACK_URL="${MICROSERVICE_URL}/api/v1/batch/callback"'
    );
  });

  it('makes the protocol decision once, not twice', () => {
    // The comment on target_host_url calls itself "the one place the
    // protocol/port decision is made". A second copy for the subdomain is how
    // two chains come to disagree - #1081, again.
    expect(source).toContain('host_url "$TARGET_HOST"');
    expect(hostUrl({ noSsl: 1 })).toBe(
      'http://ai-commerce-accelerator-microservice.aica-e2e.demo'
    );
    expect(hostUrl({ portSuffix: ':8443' })).toBe(
      'https://ai-commerce-accelerator-microservice.aica-e2e.demo:8443'
    );
  });
});

describe('the machinery that chased a published port is gone', () => {
  it('no longer invents a free port', () => {
    // find_free_port returned a port *because* nothing was listening on it.
    expect(source).not.toMatch(/find_free_port/);
  });

  it('no longer forwards a microservice port', () => {
    // #1087's tunnel still carries 443 and 80; this was the extra forward for
    // a port that was never published.
    expect(source).not.toMatch(/forward_node_port/);
    expect(source).not.toMatch(/NODE_PORT_FORWARD_PID/);
  });

  it('still forwards 443, which is how the proxy is reached', () => {
    // Removing the wrong forward must not take the right one with it.
    expect(source).toContain('-L "443:localhost:443"');
  });

  it('leaves no orphaned helpers behind', () => {
    // is_port_free existed only for find_free_port.
    expect(source).not.toMatch(/is_port_free/);
  });
});
