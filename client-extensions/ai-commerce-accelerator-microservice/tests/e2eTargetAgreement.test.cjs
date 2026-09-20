const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The shard plan and the resolved target have to agree.
 *
 * Two places decide what the target is: the `plan` job, to choose a shard
 * count, and the e2e job, to drive the run. #1079 tried to remove that
 * duplication by passing the target as a job output - and a job output whose
 * value matches a secret is scrubbed on the way out, so the consuming job got
 * an empty string.
 *
 * The result looked fine. The run reported itself as a single remote shard and
 * went local: no node woken, the MAC registration step skipped by its own
 * `if`, and the unqualified licence used in place of the node's. Nothing
 * failed; it simply tested the wrong environment, and the report said
 * otherwise (#1081).
 *
 * So the pair is asserted at the top of the job instead. One shard means
 * remote, three means local, and a disagreement stops the run. These cases
 * extract that step from the workflow rather than restating it, so the guard
 * cannot drift from the guard that ships.
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

function agreementScript(shardTotal) {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const nameAt = lines.findIndex((line) =>
    line.includes('Check the shard plan and the target agree')
  );

  if (nameAt === -1) throw new Error('agreement step not found');

  const runAt = lines.findIndex(
    (line, i) => i > nameAt && /run: \|\s*$/.test(line)
  );
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

  // The step reads the shard total through a workflow expression, which only
  // GitHub substitutes. Standing in for it is the whole point: the shell logic
  // either agrees with the target or it does not.
  return body.join('\n').replace(/\$\{\{ matrix\.shardTotal \}\}/g, shardTotal);
}

function runAgreement({ target, shardTotal }) {
  try {
    const stdout = execFileSync('bash', ['-c', agreementScript(shardTotal)], {
      env: {
        PATH: process.env.PATH,
        ...(target === undefined ? {} : { E2E_TARGET_NODE: target }),
      },
      encoding: 'utf8',
    });

    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

describe('the shard plan and the target must agree', () => {
  it('accepts one shard for a remote target', () => {
    expect(runAgreement({ target: 'aws-2', shardTotal: 1 }).ok).toBe(true);
  });

  it('accepts three shards for local', () => {
    expect(runAgreement({ target: 'local', shardTotal: 3 }).ok).toBe(true);
  });

  it('refuses a local target planned as one shard', () => {
    // The shape #1079 produced: the matrix says remote, the job is local.
    const result = runAgreement({ target: 'local', shardTotal: 1 });

    expect(result.ok).toBe(false);
    expect(result.stdout).toMatch(/disagree/);
  });

  it('refuses an empty target planned as one shard', () => {
    // Exactly what a scrubbed job output looks like from in here.
    const result = runAgreement({ target: '', shardTotal: 1 });

    expect(result.ok).toBe(false);
  });

  it('refuses an unset target planned as one shard', () => {
    expect(runAgreement({ target: undefined, shardTotal: 1 }).ok).toBe(false);
  });

  it('refuses a remote target planned as three shards', () => {
    // The other direction: three shards would share one node and one project.
    expect(runAgreement({ target: 'aws-1', shardTotal: 3 }).ok).toBe(false);
  });
});
