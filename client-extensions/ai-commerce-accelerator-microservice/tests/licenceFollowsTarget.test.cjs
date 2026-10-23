const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * The activation key deployed for the node this run targets (#805).
 *
 * Each remote node has its own LIFERAY_LICENSE_<NODE> secret. The workflow
 * never names them - the names are the node names (#1383) - so
 * scripts/select_node_licence.py picks the target's from `toJSON(secrets)` and
 * passes the path of a private file as LIFERAY_LICENSE_FILE. LIFERAY_LICENSE,
 * a developer licence, is the fallback. Node names here are placeholders.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);

function extract(source, name) {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf('\n}\n', start);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, end + 3);
}

const KEY_A = '<license>for node-a</license>';
const KEY_DEV = '<license>developer</license>';

function deploy(env, nodeKey) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'licence-'));
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const extra = {};

  if (nodeKey !== undefined) {
    const keyFile = path.join(project, 'node-key.xml');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(keyFile, nodeKey);
    extra.LIFERAY_LICENSE_FILE = keyFile;
  }

  try {
    const out = execFileSync(
      'bash',
      [
        '-c',
        [
          'set -eu',
          extract(source, 'deploy_activation_key'),
          'deploy_activation_key',
        ].join('\n'),
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          PROJECT_NAME: project,
          ...extra,
          ...env,
        },
      }
    );
    const file = path.join(project, 'deploy', 'activation-key.xml');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const written = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    return { out, written };
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

describe('the activation key follows the target node (#805, #1383)', () => {
  it("deploys the node's own key when one was selected", () => {
    const { out, written } = deploy(
      { LDM_NODE_TARGET: 'node-a', LIFERAY_LICENSE: KEY_DEV },
      KEY_A
    );

    expect(written).toBe(KEY_A);
    expect(out).toMatch(/from the target node's activation key/);
  });

  it('falls back to the developer licence, saying so, when the node has none', () => {
    const { out, written } = deploy({
      LDM_NODE_TARGET: 'node-b',
      LIFERAY_LICENSE: KEY_DEV,
    });

    expect(written).toBe(KEY_DEV);
    expect(out).toMatch(/No activation key is configured for node 'node-b'/);
  });

  it('uses the developer licence locally, without a warning', () => {
    const { out, written } = deploy({
      LDM_NODE_TARGET: 'local',
      LIFERAY_LICENSE: KEY_DEV,
    });

    expect(written).toBe(KEY_DEV);
    expect(out).not.toMatch(/falling back/);
  });

  it('deploys nothing, and does not fail, with no key at all', () => {
    const { out, written } = deploy({ LDM_NODE_TARGET: 'node-a' });

    expect(written).toBeNull();
    expect(out).toMatch(/deploying no activation key/);
  });

  it('never prints the key itself', () => {
    const { out } = deploy({ LDM_NODE_TARGET: 'node-a' }, KEY_A);

    expect(out).not.toContain(KEY_A);
  });

  it('names no node-specific secret in the workflow', () => {
    // Comments stripped: the workflow's prose explains the per-node secrets,
    // and must neither satisfy nor fail this.
    const workflow = withoutHashComments(
      fs.readFileSync(
        path.resolve(
          __dirname,
          '..',
          '..',
          '..',
          '.github',
          'workflows',
          'e2e-verification.yml'
        ),
        'utf8'
      )
    );

    expect(workflow).toMatch(/ALL_SECRETS: \$\{\{ toJSON\(secrets\) \}\}/);
    expect(workflow).not.toMatch(/secrets\.LIFERAY_LICENSE_[A-Z0-9_]+/);
  });
});
