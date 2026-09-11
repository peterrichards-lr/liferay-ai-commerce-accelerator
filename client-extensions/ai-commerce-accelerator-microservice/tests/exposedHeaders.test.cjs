const fs = require('fs');
const path = require('path');

/**
 * A header a browser cannot read is a header that reads as zero.
 *
 * The package routes report what they built in their headers - how much media
 * could not be resolved, how many products are missing a required field - and
 * the Dashboard shows those counts. A cross-origin response only surfaces the
 * headers named in `exposedHeaders`, so adding a count to a route and
 * forgetting the CORS list produces a download reporting a perfect package,
 * which is the exact silence the counts exist to break (#875, #886).
 *
 * Asserted on the sources, because the two live in different layers and
 * nothing else connects them.
 */
describe('The headers a package reports itself with', () => {
  const microservice = path.join(__dirname, '..');

  const declared = fs.readFileSync(
    path.join(microservice, 'server.cjs'),
    'utf8'
  );

  const routes = fs.readFileSync(
    path.join(microservice, 'routes', 'export.cjs'),
    'utf8'
  );

  const setHeaders = [
    ...routes.matchAll(/setHeader\(\s*'(X-AICA-[A-Za-z-]+)'/g),
  ].map((match) => match[1]);

  it('are actually set by the routes, so this test cannot pass vacuously', () => {
    expect(new Set(setHeaders).size).toBeGreaterThanOrEqual(5);
  });

  it.each([...new Set(setHeaders)])('exposes %s to the browser', (header) => {
    expect(declared).toContain(`'${header}'`);
  });

  it('exposes Content-Disposition, which names the downloaded file', () => {
    expect(declared).toContain("'Content-Disposition'");
  });
});
