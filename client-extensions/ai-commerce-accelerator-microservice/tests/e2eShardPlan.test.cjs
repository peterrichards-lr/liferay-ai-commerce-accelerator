const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * A remote target runs one shard; local runs three.
 *
 * Every shard runs the whole of `run-e2e-ldm.sh`, and under GITHUB_ACTIONS that
 * script names its project `aica-e2e` - the same name for all of them. That was
 * harmless while each shard ran on its own ephemeral runner: three isolated
 * Dockers, three projects that happened to share a name.
 *
 * Threading `--node` through (#1077) made them all target one compute node, so
 * the same three became three concurrent `ldm run aica-e2e` against a single
 * host - all waking it, all provisioning into it, all tearing it down on exit.
 * The first run after that change had all three shards fail inside two minutes,
 * two rejected at SSH authentication and one finding the port closed again.
 *
 * The plan step is executed as the workflow defines it rather than reimplemented
 * here, so this cannot drift from what CI runs. The assertion that matters is
 * the shard count for a remote target: three of anything sharing one node and
 * one project name is the defect, whatever the node is called. See #1079.
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

function planFor(requestedNode) {
  // Taken by indentation rather than by a lookahead: a regex ending at "the
  // next key" swallowed the following job header the first time, and a block
  // scalar's extent is defined by indentation anyway.
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const idAt = lines.findIndex((line) => line.includes('id: plan'));

  if (idAt === -1)
    throw new Error('plan step not found in e2e-verification.yml');

  const runAt = lines.findIndex(
    (line, i) => i > idAt && /run: \|\s*$/.test(line)
  );

  if (runAt === -1) throw new Error('plan step has no run block');

  const indent = lines[runAt].search(/\S/) + 2;
  const body = [];

  for (let i = runAt + 1; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.trim() === '') {
      body.push('');
      continue;
    }
    if (line.search(/\S/) < indent) break;
    body.push(line.slice(indent));
  }

  const script = body.join('\n');

  const outFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'shard-plan-')),
    'out'
  );

  fs.writeFileSync(outFile, '');
  execFileSync('bash', ['-c', script], {
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: outFile,
      ...(requestedNode === undefined ? {} : { REQUESTED_NODE: requestedNode }),
    },
  });

  const out = fs.readFileSync(outFile, 'utf8');
  const read = (key) => out.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];

  return { target: read('target'), matrix: JSON.parse(read('matrix')) };
}

describe('the E2E shard plan (#1077)', () => {
  it('runs a single shard against a remote node', () => {
    const plan = planFor('aws-2');

    expect(plan.target).toBe('aws-2');
    expect(plan.matrix).toEqual({ shardIndex: [1], shardTotal: [1] });
  });

  it('does so for any remote node, not just the one that broke', () => {
    expect(planFor('aws-1').matrix.shardIndex).toHaveLength(1);
  });

  it('keeps three shards for local, where each owns its runner', () => {
    const plan = planFor('local');

    expect(plan.target).toBe('local');
    expect(plan.matrix).toEqual({ shardIndex: [1, 2, 3], shardTotal: [3] });
  });

  it('treats an unset target as local', () => {
    // The resolution chain ends in 'local', but an empty string reaches the
    // step when a dispatch input is present and blank.
    expect(planFor('').target).toBe('local');
    expect(planFor(undefined).target).toBe('local');
  });

  it('never plans more shards than the shard total claims', () => {
    // The pair has to agree: Playwright is told `--shard i/total`, so a total
    // that does not match the number of jobs silently skips or repeats tests.
    for (const node of ['local', 'aws-1', 'aws-2', '']) {
      const { matrix } = planFor(node);

      expect(matrix.shardTotal).toEqual([matrix.shardIndex.length]);
    }
  });
});
