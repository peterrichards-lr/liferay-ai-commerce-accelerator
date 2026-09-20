const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Every LDM call names the compute target, or it silently means "local".
 *
 * `--node` reached node_power.sh, the licence lookup and the sleep in the EXIT
 * trap, and no `ldm` invocation at all. Nothing ran `ldm target use` either, so
 * on a CI runner - where `~/.ldmrc` starts empty and there is no persisted
 * default - `ldm import`, `run`, `deploy`, `wait` and `logs` all resolved to
 * local while the workflow believed it was driving a remote node.
 *
 * That is why the activation key kept failing. #805 registered the node with
 * the MAC its licence is bound to, which was necessary and not sufficient: the
 * container never started on that node, so it took a bridge MAC and DXP refused
 * the key - "MAC address matching failed, allowed MAC addresses: [...]" - then
 * logged "License registered" at INFO on the very next line and served the
 * Activation page anyway. Four failures downstream, none naming the cause.
 *
 * The real `ldm_cmd` is extracted from the script and run against a stub `ldm`
 * that records its argv, so this exercises the shipped function rather than a
 * copy of it. Asserting the argv is the point: nothing in a passing E2E run
 * would reveal the flag missing, which is how it went unnoticed (#1077).
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);

function ldmCmdArgv({ target, args }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldm-node-'));
  const argvFile = path.join(dir, 'argv');
  const stub = path.join(dir, 'ldm');

  fs.writeFileSync(stub, `#!/bin/bash\nprintf '%s\\n' "$@" > "${argvFile}"\n`);
  fs.chmodSync(stub, 0o755);

  const source = fs.readFileSync(SCRIPT, 'utf8');
  const fn = source.match(/^ldm_cmd\(\) \{[\s\S]*?^\}/m);

  if (!fn) throw new Error('ldm_cmd not found in run-e2e-ldm.sh');

  const program = [
    'log_command() { :; }',
    fn[0],
    `ldm_cmd ${args.join(' ')}`,
  ].join('\n');

  execFileSync('bash', ['-c', program], {
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      ...(target === undefined ? {} : { LDM_NODE_TARGET: target }),
    },
  });

  return fs.readFileSync(argvFile, 'utf8').trim().split('\n');
}

describe('the compute target reaches every LDM call', () => {
  it('appends --node when a remote target is named', () => {
    const argv = ldmCmdArgv({ target: 'aws-2', args: ['run', 'aica-e2e'] });

    expect(argv).toEqual(['run', 'aica-e2e', '--node', 'aws-2']);
  });

  it('does so for import as well as run', () => {
    // Every subcommand this script issues accepts --node; the wrapper is the
    // single place that knows, so none of them can be forgotten individually.
    const argv = ldmCmdArgv({ target: 'aws-1', args: ['import', '.', 'proj'] });

    expect(argv).toEqual(['import', '.', 'proj', '--node', 'aws-1']);
  });

  it('adds nothing when the target is local', () => {
    const argv = ldmCmdArgv({ target: 'local', args: ['run', 'proj'] });

    expect(argv).toEqual(['run', 'proj']);
  });

  it('adds nothing when no target is set', () => {
    const argv = ldmCmdArgv({ target: undefined, args: ['run', 'proj'] });

    expect(argv).toEqual(['run', 'proj']);
  });

  it('keeps the caller flags intact ahead of it', () => {
    const argv = ldmCmdArgv({
      target: 'aws-2',
      args: ['run', 'proj', '--sidecar', '--no-wait'],
    });

    expect(argv).toEqual([
      'run',
      'proj',
      '--sidecar',
      '--no-wait',
      '--node',
      'aws-2',
    ]);
  });
});
