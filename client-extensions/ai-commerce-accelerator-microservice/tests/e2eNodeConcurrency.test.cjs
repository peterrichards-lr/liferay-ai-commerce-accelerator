const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Two runs must not take the same compute node at once.
 *
 * The concurrency group keyed on `github.ref`, but what two runs contend for
 * is the node. A scheduled run on master and a dispatch from a branch landed
 * in different groups and took the same machine - same host, same
 * `aica-e2e` project name, each tearing down what the other was using. That
 * is the shape that made three shards destroy each other in #1077, arriving
 * by a different route.
 *
 * The node cannot be named in the group directly: its value equals
 * secrets.LDM_NODE_TARGET, and a job output matching a secret is scrubbed to
 * an empty string (#1081). So `plan` emits a digest, which does not match the
 * secret and survives.
 *
 * The plan step is executed as the workflow defines it rather than restated
 * here, so the guard cannot drift from what CI runs.
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
const source = fs.readFileSync(WORKFLOW, 'utf8');

function planFor(requestedNode) {
  const lines = source.split('\n');
  const idAt = lines.findIndex((l) => l.includes('id: plan'));
  const runAt = lines.findIndex((l, i) => i > idAt && /run: \|\s*$/.test(l));
  const indent = lines[runAt].search(/\S/) + 2;
  const body = [];

  for (let i = runAt + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') {
      body.push('');
      continue;
    }
    if (lines[i].search(/\S/) < indent) break;
    body.push(lines[i].slice(indent));
  }

  const outFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'conc-')),
    'out'
  );

  fs.writeFileSync(outFile, '');
  execFileSync('bash', ['-c', body.join('\n')], {
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: outFile,
      ...(requestedNode === undefined ? {} : { REQUESTED_NODE: requestedNode }),
    },
  });

  const out = fs.readFileSync(outFile, 'utf8');

  return {
    target: out.match(/^target=(.*)$/m)?.[1],
    nodeKey: out.match(/^node_key=(.*)$/m)?.[1],
  };
}

describe('runs serialise on the node they share', () => {
  it('gives each remote node its own key', () => {
    // Two nodes must not collide, or a run on aws-1 would block aws-2.
    expect(planFor('aws-1').nodeKey).not.toBe(planFor('aws-2').nodeKey);
  });

  it('gives the same node the same key every time', () => {
    // The key is only useful if it is stable: a per-run value would put every
    // run in its own group and serialise nothing.
    expect(planFor('aws-2').nodeKey).toBe(planFor('aws-2').nodeKey);
  });

  it('never puts the node name in the key', () => {
    // The name equals a secret. Emitting it gets the output scrubbed to empty,
    // which is the failure this exists to avoid.
    const { nodeKey } = planFor('aws-2');

    expect(nodeKey).not.toContain('aws-2');
    expect(nodeKey).toMatch(/^node-[0-9a-f]{12}$/);
  });

  it('marks local as local, so ref semantics still apply', () => {
    expect(planFor('local').nodeKey).toBe('local');
    expect(planFor('').nodeKey).toBe('local');
    expect(planFor(undefined).nodeKey).toBe('local');
  });
});

describe('the concurrency group uses it', () => {
  const group = source.match(/group: (.*)/)?.[1] ?? '';
  const cancel = source.match(/cancel-in-progress: (.*)/)?.[1] ?? '';

  it('groups a remote run by node rather than by ref', () => {
    // The defect: a cron on master and a dispatch on a branch in different
    // groups, on one machine.
    expect(group).toContain('needs.plan.outputs.node_key');
  });

  it('still separates local runs by ref and shard', () => {
    // Local shards each own a runner; collapsing them onto one group would
    // serialise three jobs that have no reason to wait for each other.
    expect(group).toContain('github.ref');
    expect(group).toContain('matrix.shardIndex');
  });

  it('queues a remote run instead of cancelling it', () => {
    // A cancelled run can drop its teardown mid-flight and leave a billable
    // instance awake; the second run is one we want, not one to discard.
    expect(cancel).toContain("needs.plan.outputs.node_key == 'local'");
  });

  it('degrades to serialising everything if the key comes back empty', () => {
    // Scrubbing is the failure mode in play, so the empty case has to be safe.
    // The remote branch must be the key *alone*: an empty value then yields one
    // constant group for every run - slow, and safe. Mixing ref or shard into
    // that branch would scatter empty-key runs into distinct groups, which is
    // exactly the unguarded state this replaces.
    const remoteBranch = group.split('||').pop().trim();

    expect(remoteBranch).toBe('needs.plan.outputs.node_key }}');
    expect(remoteBranch).not.toContain('github.ref');
    expect(remoteBranch).not.toContain('matrix.');
  });
});
