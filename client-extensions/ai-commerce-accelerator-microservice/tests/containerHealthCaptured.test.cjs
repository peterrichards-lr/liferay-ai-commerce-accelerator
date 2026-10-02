const fs = require('node:fs');
const path = require('node:path');
const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * Container state must carry health, not only status.
 *
 * `status` says `running` for any container that started, healthy or not. It
 * could not disconfirm the hypothesis it was being used to support, and on run
 * 36707123322 it printed `status=running` while the container was running AND
 * unhealthy. #1149 spent a week pointing at the proxy on the strength of it -
 * Traefik had withdrawn the router seven minutes earlier, correctly, because
 * Docker reported the container unhealthy.
 *
 * The health log was already being captured, in the right format, for the
 * Liferay container. The extension's - the one that mattered - was not.
 * See #1214.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const script = () => withoutHashComments(fs.readFileSync(SCRIPT, 'utf8'));

describe('container state carries health (#1214)', () => {
  it('prints health beside status', () => {
    // The line whose change turns this red, and the exact shape that shipped.
    expect(script()).toMatch(/status=\{\{\.State\.Status\}\} health=/);
  });

  it('distinguishes no healthcheck from unhealthy', () => {
    // An absent healthcheck leaves Health.Status empty, and a bare empty
    // value reads as healthy - the same ambiguity one level down.
    expect(script()).toMatch(/\{\{if \.State\.Health\}\}/);
    expect(script()).toMatch(/none-declared/);
  });

  it('captures the EXTENSION health log, not only Liferay ones', () => {
    // The defect exactly: the capture existed, in the right format, pointed
    // at the wrong container.
    const source = script();
    const logBlocks = source.match(/\{\{range \.State\.Health\.Log\}\}/g) || [];

    expect(logBlocks.length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/extension health transitions/);
  });
});

describe('credential fingerprints (#1215)', () => {
  it('hashes the credentials rather than printing them', () => {
    const source = script();

    expect(source).toMatch(/sha256sum/);
    expect(source).toMatch(/client\.secret/);
    // The artifact is uploaded wholesale. A capture that read the value would
    // put a live secret in it.
    expect(source).not.toMatch(/cat .*client\.secret/);
  });

  it('truncates the hash, so it identifies without reconstructing', () => {
    expect(script()).toMatch(/cut -c1-16/);
  });

  it('redacts its own output, like every other block that reads the tree', () => {
    // Not belt-and-braces. This is the only block that reads credential FILES,
    // it writes into an artifact uploaded wholesale - and since #1169 uploaded
    // on GREEN runs too - and a `docker exec` that fails unexpectedly puts
    // whatever it emitted there. The first version had no filter and
    // microserviceDiagnosticsCaptured caught it by feeding the command a
    // fixture containing a secret.
    const block = script().match(
      /credential fingerprints[\s\S]*?compose depends_on/
    );

    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/<redacted>/);
  });
});
