const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * A stale project on the node must be removed before the build.
 *
 * The removal was guarded by `[ -d "$PROJECT_NAME" ]` - a *local* directory.
 * A CI runner is ephemeral, so on a remote target there is never a local
 * directory: the guard was false on every CI run and the removal never fired,
 * while the project itself sat on the node. A previous run's leftovers were
 * adopted rather than replaced - Liferay attached to a half-initialised
 * database, booted in 40s instead of 231s, and failed with
 * NoSuchCompanyException (#1122).
 *
 * It also called bare `ldm` rather than `ldm_cmd`, so even on a local run -
 * where the guard could be true - it removed a project on this host while the
 * stale one lived on the node.
 *
 * These cases execute the real script prefix with `ldm` substituted and record
 * what it was asked to do, rather than asserting on the source text.
 *
 * The last case covers definition order. `ldm_cmd` calls `log_command` on
 * every invocation, and relocating the removal put the call 140 lines above
 * that definition. The removal itself survives it - `|| true` disables `set -e`
 * for the whole body, so `log_command` exiting 127 is absorbed and `ldm` still
 * runs - but every *unguarded* `ldm_cmd` in the script aborts at 127 before
 * running its command at all. The symptom is a stderr line, so the case has to
 * read stderr to see it.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');

function prefixThroughRemoval() {
  const marker = lines.findIndex((l) => l.includes('Removing any stale'));
  if (marker === -1) {
    throw new Error('stale-project removal is gone from the script');
  }
  const end = lines.indexOf('fi', marker);
  if (end === -1) {
    throw new Error('could not find the end of the removal block');
  }
  return lines.slice(0, end + 1);
}

// Substitutes the two things that would leave this machine: the ldm binary,
// and the lookup that asks a real node for its SSH endpoint. Everything
// between them - argument parsing, ldm_cmd, the routing gate, the guard - is
// the script's own code, run as written.
function run({ args = [], cwd }) {
  const log = path.join(cwd, 'ldm-calls.log');
  const body = prefixThroughRemoval()
    .join('\n')
    .replace(
      /^ldm\(\) \{[\s\S]*?\n\}/m,
      `ldm() {\n    echo "ldm $*" >> "${log}"\n}`
    )
    .replace(
      /^node_ssh_endpoint\(\) \{[\s\S]*?\n\}/m,
      'node_ssh_endpoint() {\n    echo "ci@node.example"\n}'
    );

  const harness = path.join(cwd, 'prefix.sh');
  fs.writeFileSync(harness, body);

  // spawnSync, not execFileSync: the ordering case below turns on a
  // "command not found" that bash writes to stderr, and execFileSync returns
  // stdout alone. An earlier version of this file missed that and the case
  // passed against a script it could not see the failure of.
  const result = spawnSync('bash', [harness, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DOCKER_HOST: '' },
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    calls: fs.existsSync(log)
      ? fs.readFileSync(log, 'utf8').trim().split('\n')
      : [],
  };
}

function sandbox(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-stale-'));
  // The sentinel pre-flight is a local-run-only step and not under test here.
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'scripts', 'preflight.mjs'), '');
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const removals = (calls) =>
  calls.filter((c) => /^ldm rm\b/.test(c) || / rm .*--delete/.test(c));

describe('stale project removal', () => {
  test('removes the project on a remote target with no local directory', () => {
    sandbox((dir) => {
      const { calls } = run({ args: ['--node', 'aws-1'], cwd: dir });
      // No local directory exists here - which is precisely the CI shape that
      // the old `[ -d "$PROJECT_NAME" ]` guard read as "nothing to remove".
      expect(removals(calls).length).toBeGreaterThan(0);
    });
  });

  test('addresses the node, not this host', () => {
    sandbox((dir) => {
      const { calls } = run({ args: ['--node', 'aws-1'], cwd: dir });
      const rm = removals(calls)[0];
      expect(rm).toMatch(/--node aws-1/);
    });
  });

  test('still removes on a local run', () => {
    sandbox((dir) => {
      const { calls } = run({ args: [], cwd: dir });
      expect(removals(calls).length).toBeGreaterThan(0);
      expect(removals(calls)[0]).not.toMatch(/--node/);
    });
  });

  test('leaves a project the caller named alone', () => {
    sandbox((dir) => {
      const { calls } = run({
        args: ['--node', 'aws-1', '--project', 'mine'],
        cwd: dir,
      });
      expect(removals(calls)).toEqual([]);
    });
  });

  test('deletes the volume, not just the containers', () => {
    sandbox((dir) => {
      const { calls } = run({ args: ['--node', 'aws-1'], cwd: dir });
      // NoSuchCompanyException came from a retained database volume: `rm`
      // without --delete leaves it, and the next run attaches to it.
      expect(removals(calls)[0]).toMatch(/--delete/);
    });
  });

  test('runs after docker is routed to the node', () => {
    sandbox((dir) => {
      const { stdout } = run({ args: ['--node', 'aws-1'], cwd: dir });
      const routed = stdout.indexOf('Routing docker');
      const removed = stdout.indexOf('Removing any stale');
      expect(routed).toBeGreaterThan(-1);
      expect(removed).toBeGreaterThan(routed);
    });
  });

  // Source order, not behaviour - deliberately. The removal redirects
  // `2>/dev/null` and is wrapped in `|| true`, so a helper missing at *this*
  // call site is both invisible and harmless: `set -e` is off for the body,
  // `log_command` exits 127, and `ldm` still runs. The damage lands on every
  // other `ldm_cmd` call - those are unguarded and abort at 127 before running
  // their command at all. That cannot be provoked from the prefix this file
  // executes, so it is asserted where it is actually decidable.
  //
  // shellcheck does not cover it: SC2218 fires on a direct call to a function
  // defined later, not on one reached through another function.
  test('helpers ldm_cmd needs are defined before ldm_cmd is first called', () => {
    const defLine = (name) =>
      lines.findIndex((l) => l.startsWith(`${name}() {`));

    const ldmCmdDef = defLine('ldm_cmd');
    expect(ldmCmdDef).toBeGreaterThan(-1);

    const body = lines
      .slice(ldmCmdDef + 1, lines.indexOf('}', ldmCmdDef))
      .join('\n');

    // Comments in this script discuss ldm_cmd by name, so prose has to be
    // excluded or the "first call" lands on a remark about one.
    const firstCall = lines.findIndex(
      (l, i) =>
        i !== ldmCmdDef &&
        !l.trim().startsWith('#') &&
        /(^|[^\w-])ldm_cmd\s/.test(l)
    );
    expect(firstCall).toBeGreaterThan(-1);

    const helpers = [...body.matchAll(/^\s*([a-z_][a-z0-9_]*)\s/gm)]
      .map((m) => m[1])
      .filter((name) => defLine(name) > -1);

    expect(helpers.length).toBeGreaterThan(0);
    expect(helpers.filter((h) => defLine(h) > firstCall)).toEqual([]);
  });
});
