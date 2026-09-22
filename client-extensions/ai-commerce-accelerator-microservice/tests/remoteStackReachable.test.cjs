const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * A remote target's stack must be reachable at the URL the suite drives.
 *
 * Playwright runs on the CI runner; the stack runs on the compute node. The
 * workflow writes `aica-e2e.demo -> 127.0.0.1` into /etc/hosts unconditionally,
 * which is true for a local run and false for a remote one - so the suite spent
 * a run driving its own loopback while Liferay ran in Stockholm.
 *
 * Liferay was up at 08:23:26 and readiness gave up at 08:46:54, 23 minutes
 * later, against an address nothing was serving.
 *
 * Forwarding the node's 443/80 onto this host makes that hosts entry true
 * instead of rewriting it, which keeps the name the browser asks for equal to
 * the name on the certificate. These cases extract the functions from the
 * script rather than restating them, and drive them with a recording `ssh`, so
 * the guard cannot drift from what ships.
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

function functionSource(...names) {
  const lines = source.split('\n');
  const out = [];

  for (const name of names) {
    const start = lines.findIndex((l) => l.startsWith(`${name}() {`));

    if (start === -1) throw new Error(`${name}() not found in run-e2e-ldm.sh`);

    const end = lines.findIndex((l, i) => i > start && l === '}');

    out.push(lines.slice(start, end + 1).join('\n'));
  }
  return out.join('\n\n');
}

// A port the kernel says is free, asked for at the moment it is needed.
//
// The suite runs on the same host as a local E2E stack, where the real proxy
// publishes 443. The readiness probe checked that port, found the proxy, and
// reported a tunnel up before the stand-in had started - so every case read an
// argv file nothing had written. A fixed high port would only move the
// collision somewhere less obvious.
function freePort() {
  const script =
    "const s = require('net').createServer();" +
    "s.listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); });";

  return Number(
    execFileSync('node', ['-e', script], { encoding: 'utf8' }).trim()
  );
}

function harness({ node, ldmrc, sshBehaviour = 'sleep 5' }) {
  const httpsPort = freePort();
  const httpPort = freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-'));
  const bin = path.join(dir, 'bin');

  fs.mkdirSync(bin);
  // A recording stand-in for ssh: argv goes to a file, and the process either
  // lingers briefly (a tunnel that stayed up) or exits (one that could not
  // bind).
  //
  // `sleep 5`, not 10: long enough to outlive the readiness poll so a tunnel
  // that stayed up is distinguishable from one that could not bind, short
  // enough that a stand-in named `ssh` holding a `-L` port-forward command
  // line does not linger on a monitored machine.
  fs.writeFileSync(
    path.join(bin, 'ssh'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$@" > ${dir}/ssh-argv`,
      // Detach, or the backgrounded stand-in holds the pipe open and the
      // caller blocks for as long as it lingers.
      'exec 0<&- 1>&- 2>&-',
      sshBehaviour,
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  // sudo must not be the thing under test; pass straight through.
  fs.writeFileSync(path.join(bin, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n', {
    mode: 0o755,
  });

  if (ldmrc !== undefined) {
    fs.writeFileSync(path.join(dir, '.ldmrc'), JSON.stringify(ldmrc));
  }

  const script = [
    'set -u',
    // The port variables live outside the functions, so they are declared
    // here at the values the harness chose.
    `TUNNEL_HTTPS_PORT=${httpsPort}`,
    `TUNNEL_HTTP_PORT=${httpPort}`,
    functionSource(
      'node_ssh_endpoint',
      'tunnel_is_listening',
      'open_node_tunnel',
      'close_node_tunnel'
    ),
    'open_node_tunnel; echo "rc=$?"',
    // Exercises teardown, and stops a lingering stand-in outliving the case.
    'close_node_tunnel',
  ].join('\n');

  let stdout;
  try {
    stdout = execFileSync('bash', ['-c', script], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: dir,
        LDM_NODE_TARGET: node,
        TARGET_HOST: 'aica-e2e.demo',
        LDM_SSH_KEY: '/nonexistent-key',
        // Long enough that a stand-in which exits has actually been scheduled
        // and reaped by the time the loop checks. At 1s on a loaded runner,
        // `kill -0` still saw an unscheduled process as alive, so the
        // bind-failure case took the timeout path and reported the wrong
        // message. Shorter than the lingering stand-in's sleep, so the two
        // outcomes stay distinguishable.
        TUNNEL_READY_TIMEOUT: '3',
      },
    });
  } catch (e) {
    stdout = `${e.stdout || ''}${e.stderr || ''}`;
  }

  // Polled, not assumed. The stand-in is backgrounded by open_node_tunnel, so
  // bash can return before it has been scheduled - which read as "ssh was
  // invoked with no arguments" and made three cases flaky under CI load
  // rather than on this machine.
  const argvFile = path.join(dir, 'ssh-argv');
  // Only the cases that actually reach ssh: a local target returns before
  // invoking it, and so does a missing endpoint. Waiting on those would add
  // three seconds each to prove nothing.
  const sshExpected = node !== 'local' && ldmrc !== undefined;
  const deadline = Date.now() + 3000;

  while (sshExpected && !fs.existsSync(argvFile) && Date.now() < deadline) {
    execFileSync('sleep', ['0.05']);
  }

  return {
    httpsPort,
    httpPort,
    stdout,
    sshRan: fs.existsSync(argvFile),
    argv: fs.existsSync(argvFile)
      ? fs.readFileSync(argvFile, 'utf8').split('\n').filter(Boolean)
      : [],
  };
}

const LDMRC = {
  targets: { 'aws-2': { host: '203.0.113.9', user: 'ldm-automation' } },
};

// Binding 443 needs privilege, so these assert what the tunnel is asked to do,
// not a live socket. The request is the part that was wrong.
describe('a remote stack is reached through the tunnel, not the open internet', () => {
  it('binds 443 locally in production, so the certificate still matches', () => {
    // The whole point: the browser asks for aica-e2e.demo and gets the node.
    // A forward on any other port would need the URL, and the certificate, to
    // change with it. Asserted against the default in the script, because the
    // cases below deliberately run on ports nothing else holds.
    expect(source).toContain('TUNNEL_HTTPS_PORT="${TUNNEL_HTTPS_PORT:-443}"');
    expect(source).toContain('TUNNEL_HTTP_PORT="${TUNNEL_HTTP_PORT:-80}"');
  });

  it("forwards the HTTPS port to the node's 443", () => {
    const { argv, httpsPort } = harness({ node: 'aws-2', ldmrc: LDMRC });

    expect(argv).toContain(`${httpsPort}:localhost:443`);
  });

  it('forwards the HTTP port too, because Liferay redirects through it', () => {
    const { argv, httpPort } = harness({ node: 'aws-2', ldmrc: LDMRC });

    expect(argv).toContain(`${httpPort}:localhost:80`);
  });

  it('judges readiness by the port it actually bound', () => {
    // The defect: the probe hardcoded 443 while a local E2E run's real proxy
    // already published it, so readiness passed before the tunnel existed.
    expect(source).toContain('/dev/tcp/127.0.0.1/"$TUNNEL_HTTPS_PORT"');
  });

  it('connects to the address the wake step recorded', () => {
    // Re-resolving here could point the tunnel at a different address than the
    // one LDM is driving; read what was recorded instead.
    expect(harness({ node: 'aws-2', ldmrc: LDMRC }).argv).toContain(
      'ldm-automation@203.0.113.9'
    );
  });

  it('refuses to continue if the forward cannot be bound', () => {
    // ExitOnForwardFailure means an ssh that exits at once is a bind or auth
    // failure. Continuing would run the suite against nothing, which is the
    // failure mode that cost a full run.
    const result = harness({
      node: 'aws-2',
      ldmrc: LDMRC,
      sshBehaviour: 'exit 1',
    });

    expect(result.stdout).toMatch(/exited immediately/);
    expect(result.stdout).toMatch(/rc=1/);
  });

  it('fails loudly when no address was ever recorded', () => {
    const result = harness({ node: 'aws-2', ldmrc: undefined });

    expect(result.sshRan).toBe(false);
    expect(result.stdout).toMatch(/No SSH endpoint recorded/);
    expect(result.stdout).toMatch(/rc=1/);
  });

  it('does nothing at all for a local target', () => {
    // Local already has the stack on this host; a tunnel would be wrong, and
    // binding 443 would collide with the proxy.
    const result = harness({ node: 'local', ldmrc: LDMRC });

    expect(result.sshRan).toBe(false);
    expect(result.stdout).toMatch(/rc=0/);
  });
});

describe('the tunnel is actually opened, not merely defined', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  it('opens it on the main path and stops the run if it fails', () => {
    // The defect was no tunnel at all. Every case above calls the function
    // directly, so all of them pass whether or not anything invokes it -
    // deleting the call was caught by none of them.
    expect(source).toMatch(/if ! open_node_tunnel; then[\s\S]{0,160}exit 1/);
  });

  it('opens it before anything waits on readiness', () => {
    // A tunnel opened after the wait leaves the wait probing a loopback with
    // nothing on it, which is the 23 minutes this cost.
    expect(source.indexOf('if ! open_node_tunnel')).toBeGreaterThan(-1);
    expect(source.indexOf('if ! open_node_tunnel')).toBeLessThan(
      source.indexOf('ldm_cmd wait')
    );
  });

  it('closes it from the cleanup trap', () => {
    // The runner is ephemeral, but a developer's machine is not, and a stray
    // forward holds 443 against the next run.
    const cleanup = source.slice(source.indexOf('cleanup() {'));

    expect(cleanup.slice(0, cleanup.indexOf('\n}'))).toContain(
      'close_node_tunnel'
    );
  });
});

describe('readiness probes the URL the suite drives', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  it('passes the probe override to both waits', () => {
    // Two waits: HTTP readiness, then deployables. A probe override on one and
    // not the other leaves the second pointed at the node address.
    const waits = source.match(/ldm_cmd wait [^\n]*/g) || [];

    expect(waits).toHaveLength(2);
    for (const wait of waits) {
      expect(wait).toContain('"${PROBE_URL_ARGS[@]}"');
    }
  });

  it('derives the override from TARGET_URL, not a second resolution', () => {
    // TARGET_URL is what BASE_URL, LIFERAY_URL and LIFERAY_API_URL are built
    // from. A probe resolved separately is how the plan and the target came to
    // disagree in #1081.
    expect(source).toContain('PROBE_URL_ARGS=(--probe-url "$TARGET_URL")');
  });

  it('degrades instead of failing on an LDM without the flag', () => {
    // Detected by rendering the help, so the check follows the binary rather
    // than a pinned version string.
    expect(source).toMatch(/ldm wait --help[\s\S]{0,80}--probe-url/);
  });
});
