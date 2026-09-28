const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * The key has to be usable by callers that pass no identity.
 *
 * CI wrote the deploy key to `~/.ssh/aws-key.pem` and stopped there. Only a
 * caller passing `-i` could use it, and most of the callers here do not: LDM
 * drives Docker over SSH, which shells out to `ssh` carrying no identity of
 * its own, and `manage_target_nodes.py`'s shutdown is a plain
 * `ssh user@host`.
 *
 * The result read as a credentials problem rather than a configuration one:
 *
 *     07:46:09  SSH ready on <host>:22 as ldm-automation   (our probe, with -i)
 *     07:46:31  Cannot reach compute node over SSH -- it refused the SSH credentials
 *
 * Twenty-two seconds apart, same host, same user. The probe worked because it
 * named the key; LDM could not because nothing did.
 *
 * These cases run the config the workflow writes through `ssh -G`, which is
 * ssh's own resolver, rather than matching text. `-F` is explicit because on
 * macOS ssh finds the user config through the passwd entry rather than $HOME,
 * so pointing HOME at a fixture silently reads the developer's real config -
 * which is how this check first appeared to fail when the config was fine.
 */
const WORKFLOW = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'e2e-verification.yml'
);

function writtenSshConfig() {
  // Anchored on the closing line and walked backwards to its `{`. Matching
  // forwards from the first `{` instead picked up the plan step's `echo`s,
  // which are redirections rather than config lines.
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const closeAt = lines.findIndex((line) =>
    line.trim().startsWith('} > ~/.ssh/config')
  );

  if (closeAt === -1)
    throw new Error('ssh config block not found in the workflow');

  let openAt = closeAt;

  while (openAt >= 0 && lines[openAt].trim() !== '{') openAt -= 1;

  if (openAt < 0) throw new Error('ssh config block has no opening brace');

  const body = lines
    .slice(openAt + 1, closeAt)
    // Shell comments inside the block are prose, not config. Without this
    // the parser threw, and a throw in `beforeAll` reports the suite as
    // SKIPPED rather than failed - so adding a comment beside a new option
    // silently disabled all six cases while the run still looked green.
    // See #1174.
    .filter((line) => !line.trim().startsWith('#'))
    .map((line) => {
      const match = line.trim().match(/^echo "(.*)"$/);

      if (!match)
        throw new Error(`unexpected line in the block: ${line.trim()}`);

      return match[1];
    });

  if (body.length === 0)
    throw new Error('the ssh config block parsed to nothing');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshcfg-'));
  const file = path.join(dir, 'config');

  fs.writeFileSync(file, `${body.join('\n')}\n`, { mode: 0o600 });
  return file;
}

function resolved(file, host = 'example.invalid') {
  const out = execFileSync('ssh', ['-F', file, '-G', host], {
    encoding: 'utf8',
  });
  const map = {};

  for (const line of out.split('\n')) {
    const [key, ...rest] = line.split(' ');
    if (key && !(key in map)) map[key] = rest.join(' ');
  }
  return map;
}

describe('the SSH identity CI writes is discoverable without -i', () => {
  let config;

  beforeAll(() => {
    config = writtenSshConfig();
  });

  it('the block parsed, so the cases below are asserting something', () => {
    // A throw in beforeAll presents as "skipped", which reads as a pass in
    // CI output. This case exists so that a parse failure surfaces as a
    // failing assertion with the file's real content in the message.
    const body = fs.readFileSync(config, 'utf8');

    expect(body.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(6);
    expect(body).toContain('Host *');
  });

  it('names the deploy key as the identity', () => {
    // The whole point: a caller that passes no identity still finds the key.
    expect(resolved(config).identityfile).toBe('~/.ssh/aws-key.pem');
  });

  it('offers only that key', () => {
    // Without IdentitiesOnly, an agent holding other keys can get far enough
    // to be refused before this one is tried.
    expect(resolved(config).identitiesonly).toBe('yes');
  });

  it('does not stall or refuse on a rebuilt host key', () => {
    // A rebuilt instance presents a new key. Refusing there fails in a way
    // that reads exactly like refused credentials.
    expect(resolved(config).stricthostkeychecking).toBe('false');
    expect(resolved(config).userknownhostsfile).toBe('/dev/null');
  });

  it('shares one connection across every docker call', () => {
    // `DOCKER_HOST=ssh://` does not multiplex, and LDM shells out a fresh
    // `docker` CLI per command. The node's sshd journal for 2026-09-27
    // recorded 475 authentications in two hours from two runner addresses,
    // and shed 79 connections past MaxStartups (default 10:30:100). A run
    // supplies its own contention. See #1174.
    const cfg = resolved(config);

    expect(cfg.controlmaster).toBe('auto');
    expect(cfg.controlpath).toBeTruthy();

    // The master has to outlive the idle stretch while Liferay boots - about
    // fourteen minutes - or it is torn down and rebuilt into the burst that
    // follows, which is the contention this exists to remove.
    const persist = String(cfg.controlpersist || '');
    const seconds = /^(\d+)m$/.test(persist)
      ? Number(persist.replace('m', '')) * 60
      : Number(persist);

    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(900);
  });

  it('keeps an established connection alive while it sits idle', () => {
    // ConnectTimeout bounds only how long a NEW connection takes to form.
    // Nothing kept an established one open, and `DOCKER_HOST=ssh://` opens
    // one persistent connection and reuses it for the whole run.
    //
    // Four runs died with `client_loop: send disconnect: Broken pipe` at the
    // end of a long idle gap - Liferay startup is ~14 minutes and is driven
    // by ldm's own SSH, not the Docker transport - while non-Docker paths
    // kept working straight through. Two of the last three produced no
    // result at all. See #1174.
    const cfg = resolved(config);

    expect(Number(cfg.serveraliveinterval)).toBeGreaterThan(0);
    expect(Number(cfg.serveralivecountmax)).toBeGreaterThan(0);

    // The tolerated silence has to exceed the longest legitimate pause in a
    // run, or the keepalive gives up during normal operation and the cure
    // reads as the disease.
    const toleratedSeconds =
      Number(cfg.serveraliveinterval) * Number(cfg.serveralivecountmax);
    expect(toleratedSeconds).toBeGreaterThanOrEqual(120);
  });

  it('bounds the connect attempt', () => {
    expect(resolved(config).connecttimeout).not.toBe('none');
  });

  it('applies to whatever address the node comes up on', () => {
    // The address is not known until after the wake, so the entry cannot name
    // it. Two unrelated hosts must both resolve to the key.
    expect(resolved(config, '10.0.0.1').identityfile).toBe(
      '~/.ssh/aws-key.pem'
    );
    expect(resolved(config, '203.0.113.9').identityfile).toBe(
      '~/.ssh/aws-key.pem'
    );
  });
});
