const fs = require('node:fs');
const path = require('node:path');

/**
 * The port for AICA_MICROSERVICE_URL comes from the container that serves it.
 *
 * The lookup asked `docker port "${PROJECT_NAME}-sidecar" 3001`. No such
 * container has ever existed. LDM's `--sidecar` selects Liferay's internal
 * Elasticsearch - "Use internal Liferay Sidecar search instead of the shared
 * Global Search container" - which runs inside the Liferay container on
 * 127.0.0.1:9201 and publishes nothing at all.
 *
 * A remote run proved it: `aica-e2e-sidecar` appeared in exactly one line of
 * the log, the error naming it, while `aica-e2e-ai-commerce-accelerator-
 * microservice` was up and logging throughout.
 *
 * So the lookup always failed and always fell through to `find_free_port`,
 * which returns a port *because* nothing is listening on it. Both consumers
 * default to localhost:3001 (`playwright/tests/e2e/test-helper.js:41`,
 * `scripts/aica-cli.cjs:71`), so a run either got lucky or pointed them at
 * nothing - quietly, either way.
 *
 * Routing docker to the node (#1089) did not break this. It made a lookup that
 * never worked fail somewhere that says so.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const source = fs.readFileSync(SCRIPT, 'utf8');
const block = source.slice(
  source.indexOf('MICROSERVICE_CONTAINER='),
  source.indexOf('LIFERAY_BATCH_CALLBACK_URL')
);

describe('the microservice port comes from the microservice container', () => {
  it('queries the container that actually serves 3001', () => {
    expect(block).toContain(
      'MICROSERVICE_CONTAINER="${PROJECT_NAME}-ai-commerce-accelerator-microservice"'
    );
    expect(block).toContain('docker port "$MICROSERVICE_CONTAINER" 3001');
  });

  it('never asks for a -sidecar container again', () => {
    // Comments stripped first: the one above this code quotes the old lookup,
    // and a sweep that counts its own explanation as an offence is the trap
    // from #1072 - where my comment kept a stale allowlist entry alive.
    const code = source
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');

    expect(code).not.toMatch(/\$\{PROJECT_NAME\}-sidecar/);
  });

  it('does not keep calling it the sidecar in the variables either', () => {
    // The name is the defect. A variable still called SIDECAR invites the next
    // reader to believe there is such a container.
    const code = source
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');

    expect(code).not.toMatch(/SIDECAR_PORT/);
  });

  it('still refuses to invent a port on a remote target', () => {
    // #1089's guard stands: a port chosen for being free is a port nothing
    // answers on.
    expect(block).toContain('Refusing to invent one');
    expect(block).toMatch(/exit 1/);
  });

  it('keeps the local fallback, where it is meaningful', () => {
    expect(block).toContain('find_free_port 3001');
  });
});

describe('the failure says enough to diagnose itself', () => {
  it('prints what the container does publish', () => {
    // The previous message named a port that was missing and stopped. Knowing
    // what *is* published is the difference between one more run and several.
    expect(block).toMatch(/What it does publish/);
    expect(block).toMatch(/docker port "\$MICROSERVICE_CONTAINER" 2>&1/);
  });

  it('lists the containers actually on the node', () => {
    // If the name is wrong again, this is what says so immediately.
    expect(block).toMatch(/Containers on the node/);
    expect(block).toMatch(/docker ps --format/);
  });

  it('does not let the diagnostics mask the failure', () => {
    // They run after the error and before exit; a `|| true` on the exit itself
    // would turn a fatal misconfiguration back into a silent one.
    const afterDiagnostics = block.slice(
      block.indexOf('Containers on the node')
    );

    expect(afterDiagnostics).toMatch(/exit 1/);
  });
});
