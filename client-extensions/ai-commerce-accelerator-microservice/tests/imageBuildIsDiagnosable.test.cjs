const fs = require('node:fs');
const path = require('node:path');
const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * A failing image build must say why, and must not float.
 *
 * Nightlies 37106009658, 37186266764 and 37280776231 all died at
 * `RUN yarn install` in the microservice image, and none of them says why:
 * `ldm run` calls `docker compose up`, which swallows BuildKit's output beyond
 * a truncated frame. The job log has `yarn install v1.22.22`, then
 * `[1/4] Resolving packages...`, then nothing. Three days, no error.
 *
 * Same family as #1194, #1201 and #1214 — a capture that reports a failure
 * without reporting the failure — this time in the build path. See #1235.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-e2e-ldm.sh');
const DOCKERFILE = path.join(
  ROOT,
  'client-extensions',
  'ai-commerce-accelerator-microservice',
  'Dockerfile'
);

const script = () => withoutHashComments(fs.readFileSync(SCRIPT, 'utf8'));
const dockerfile = () => fs.readFileSync(DOCKERFILE, 'utf8');

describe('the image build is diagnosable (#1235)', () => {
  it('builds with captured output before the stack is started', () => {
    const source = script();

    expect(source).toMatch(/docker compose[\s\S]{0,80}build/);
    // Plain progress, or BuildKit collapses the very output this captures.
    expect(source).toMatch(/--progress plain/);
  });

  it('builds BEFORE ldm run, or the capture is pointless', () => {
    // `ldm run` is what fails; a capture after it never executes.
    const source = script();
    const build = source.indexOf('docker compose --project-directory');
    const run = source.indexOf('Starting Liferay container with tag');

    expect(build).toBeGreaterThan(-1);
    expect(build).toBeLessThan(run);
  });

  it('cannot fail the run on its own', () => {
    // Diagnostics must not become a second way for the run to die.
    expect(script()).toMatch(/build reported a failure/);
  });
});

describe('the base image does not float (#1235)', () => {
  it('is pinned by digest, not a tag', () => {
    const from = dockerfile().match(/^FROM\s+(\S+)/m);

    expect(from).not.toBeNull();
    expect(from[1]).toMatch(/@sha256:[0-9a-f]{64}$/);
    // The line whose change turns this red, and the exact shape that shipped.
    expect(from[1]).not.toMatch(/:latest$/);
  });
});
