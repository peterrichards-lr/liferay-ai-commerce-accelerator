const {
  collectProblems,
} = require('../../../scripts/smoke-check-quickstart.cjs');

/**
 * The smoke check a booted quickstart is held to (#1367). Each check is
 * exercised on otherwise healthy facts, and the assertion is that exactly one
 * problem is raised - which is what fails if a check is weakened into never
 * firing.
 */
const healthy = () => ({
  host: 'aica.demo',
  portalUrl: 'https://aica.demo',
  portal: { status: 200, error: null },
  microservice: { status: 200, error: null },
  site: { status: 200, error: null },
  mainDomain: 'aica.demo',
  liferayScripts: [],
});

describe('quickstart smoke check', () => {
  it('passes a healthy quickstart', () => {
    expect(collectProblems(healthy())).toEqual([]);
  });

  it('accepts a redirect from the portal root', () => {
    expect(
      collectProblems({ ...healthy(), portal: { status: 302, error: null } })
    ).toEqual([]);
  });

  it.each([
    [
      'Liferay does not answer',
      { portal: { status: null, error: 'ECONNREFUSED' } },
      /Liferay at/,
    ],
    ['the portal errors', { portal: { status: 502, error: null } }, /HTTP 502/],
    [
      'the microservice is unhealthy',
      { microservice: { status: 503, error: null } },
      /microservice health/,
    ],
    [
      'the site was never created',
      { site: { status: 404, error: null } },
      /site 'ai-commerce-accelerator'/,
    ],
    [
      'the DXP tree says localhost (#1283)',
      { mainDomain: 'localhost' },
      /'localhost', not 'aica.demo'/,
    ],
    [
      'the DXP tree carries a port (#1407)',
      { mainDomain: 'aica.demo:8080' },
      /'aica.demo:8080'/,
    ],
    [
      'the DXP tree was never written',
      { mainDomain: null },
      /has not published it/,
    ],
    [
      'tooling runs at boot (#1365)',
      { liferayScripts: ['check-docs-rendered.sh', 'README.md'] },
      /check-docs-rendered\.sh/,
    ],
    [
      'the boot scripts cannot be listed',
      { liferayScripts: null },
      /Could not list/,
    ],
  ])('raises exactly one problem when %s', (_name, change, message) => {
    const problems = collectProblems({ ...healthy(), ...change });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(message);
  });

  it('does not count a non-script file in the scripts directory', () => {
    expect(
      collectProblems({ ...healthy(), liferayScripts: ['README.md'] })
    ).toEqual([]);
  });
});
