const fs = require('node:fs');
const path = require('node:path');

/**
 * Nothing billable is woken before the build can run.
 *
 * The Gradle wrapper fetches its distribution from an external host on every
 * run, with a 10s timeout and no retry. Two consecutive runs died there:
 *
 *   read timeout (10000ms)                           - PR CI
 *   HTTP 504 from the release host                   - the nightly
 *
 * The same URL served 200 from elsewhere at the same time, so this is a remote
 * host having a bad minute rather than a broken build.
 *
 * The nightly's cost is the part that matters. The build runs inside the E2E
 * step, which is *after* the node is powered on - so the instance was woken,
 * did nothing, and was put back to sleep, twice. Fetching the distribution
 * before the wake makes a bad minute cost nothing.
 */
const WORKFLOWS = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows'
);
const e2e = fs.readFileSync(
  path.join(WORKFLOWS, 'e2e-verification.yml'),
  'utf8'
);
const ci = fs.readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');

const lineOf = (source, needle) =>
  source.split('\n').findIndex((l) => l.includes(needle));

describe('the Gradle distribution is fetched before anything costs money', () => {
  it('fetches it before the node is woken', () => {
    // The ordering *is* the fix. After the wake, a failed download still
    // leaves a billable instance to power off.
    const fetchAt = lineOf(
      e2e,
      'Fetch the Gradle distribution before anything'
    );
    const wakeAt = lineOf(e2e, 'Wake remote target node');

    expect(fetchAt).toBeGreaterThan(-1);
    expect(wakeAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeLessThan(wakeAt);
  });

  it('retries rather than failing on one bad response', () => {
    const step = e2e.slice(lineOf(e2e, 'Fetch the Gradle distribution') * 0);
    const body = step.slice(
      step.indexOf('Fetch the Gradle distribution'),
      step.indexOf('Wake remote target node')
    );

    expect(body).toMatch(/for attempt in 1 2 3/);
    expect(body).toMatch(/sleep 15/);
  });

  it('fails the run when every attempt fails', () => {
    // A warm-up that swallows its own failure just moves the error later,
    // back to after the wake.
    const body = e2e.slice(
      e2e.indexOf('Fetch the Gradle distribution'),
      e2e.indexOf('Wake remote target node')
    );

    expect(body).toMatch(/::error::/);
    expect(body).toMatch(/exit 1/);
  });

  it('says the retry is free, because that is the point', () => {
    const body = e2e.slice(
      e2e.indexOf('Fetch the Gradle distribution'),
      e2e.indexOf('Wake remote target node')
    );

    expect(body).toMatch(/costs nothing to retry/);
  });
});

describe('the distribution is cached so most runs never fetch it', () => {
  it('caches it in the E2E workflow', () => {
    expect(e2e).toMatch(/java-version: '21'[\s\S]{0,400}?cache: 'gradle'/);
  });

  it('caches it in CI too', () => {
    // CI hit the same failure first; fixing only the nightly would leave every
    // pull request exposed to it.
    expect(ci).toMatch(/java-version: '21'[\s\S]{0,400}?cache: 'gradle'/);
  });
});
