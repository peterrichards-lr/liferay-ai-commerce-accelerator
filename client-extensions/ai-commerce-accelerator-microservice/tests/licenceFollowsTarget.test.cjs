const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * The activation key deployed for the node this run targets (#805).
 *
 * One secret, LIFERAY_LICENSES, maps node names to base64 activation keys. It
 * replaced one secret per node, because those were named after Peter's nodes
 * and the names sat in the public workflow (#1383). LIFERAY_LICENSE stays the
 * unqualified fallback. Node names here are placeholders.
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
const KEY_ANY = '<license>unqualified</license>';
const b64 = (text) => Buffer.from(text).toString('base64');

function deploy(env) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'licence-'));
  const source = fs.readFileSync(SCRIPT, 'utf8');

  try {
    const out = execFileSync(
      'bash',
      [
        '-c',
        [
          'set -eu',
          extract(source, 'node_license_from_map'),
          extract(source, 'deploy_activation_key'),
          'deploy_activation_key',
        ].join('\n'),
      ],
      {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, PROJECT_NAME: project, ...env },
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
  it("deploys the node's own key from the map", () => {
    const { out, written } = deploy({
      LDM_NODE_TARGET: 'node-a',
      LIFERAY_LICENSES: JSON.stringify({ 'node-a': b64(KEY_A) }),
      LIFERAY_LICENSE: KEY_ANY,
    });

    expect(written).toBe(KEY_A);
    expect(out).toMatch(/from LIFERAY_LICENSES/);
  });

  it('falls back to the unqualified key, saying so, when the node has none', () => {
    const { out, written } = deploy({
      LDM_NODE_TARGET: 'node-b',
      LIFERAY_LICENSES: JSON.stringify({ 'node-a': b64(KEY_A) }),
      LIFERAY_LICENSE: KEY_ANY,
    });

    expect(written).toBe(KEY_ANY);
    expect(out).toMatch(/no usable entry for node 'node-b'/);
  });

  it('treats an unreadable map as no entry, not as a failure', () => {
    const { written } = deploy({
      LDM_NODE_TARGET: 'node-a',
      LIFERAY_LICENSES: '{not json',
      LIFERAY_LICENSE: KEY_ANY,
    });

    expect(written).toBe(KEY_ANY);
  });

  it('uses the unqualified key locally, ignoring the map', () => {
    const { out, written } = deploy({
      LDM_NODE_TARGET: 'local',
      LIFERAY_LICENSES: JSON.stringify({ 'node-a': b64(KEY_A) }),
      LIFERAY_LICENSE: KEY_ANY,
    });

    expect(written).toBe(KEY_ANY);
    expect(out).not.toMatch(/falling back/);
  });

  it('deploys nothing, and does not fail, with neither secret', () => {
    const { out, written } = deploy({ LDM_NODE_TARGET: 'node-a' });

    expect(written).toBeNull();
    expect(out).toMatch(/deploying no activation key/);
  });

  it('never prints the key itself', () => {
    const { out } = deploy({
      LDM_NODE_TARGET: 'node-a',
      LIFERAY_LICENSES: JSON.stringify({ 'node-a': b64(KEY_A) }),
    });

    expect(out).not.toContain(KEY_A);
    expect(out).not.toContain(b64(KEY_A));
  });

  it('names no node-specific secret in the workflow', () => {
    // Comments stripped: the workflow's prose explains the old per-node
    // secrets, and must neither satisfy nor fail this.
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

    expect(workflow).toMatch(
      /LIFERAY_LICENSES: \$\{\{ secrets\.LIFERAY_LICENSES \}\}/
    );
    expect(workflow).not.toMatch(/LIFERAY_LICENSE_[A-Z0-9_]+:/);
  });
});
