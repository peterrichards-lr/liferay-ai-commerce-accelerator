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

  const body = lines.slice(openAt + 1, closeAt).map((line) => {
    const match = line.trim().match(/^echo "(.*)"$/);

    if (!match) throw new Error(`unexpected line in the block: ${line.trim()}`);

    return match[1];
  });

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
