const fs = require('node:fs');
const path = require('node:path');

/**
 * The tests ask for the site at the URL Liferay actually gives it.
 *
 * A remote run created the site - `Initialized AI Commerce Accelerator for
 * group 36143` - and then 404'd on /web/aica for the rest of the suite. Seven
 * specs failed against a page that was never the right one.
 *
 * The URL cannot be declared. Checked against Liferay's BundleSiteInitializer:
 *
 *   - `friendlyURL` is read only from page.json and menu items, never for the
 *     site
 *   - `site-configuration.json` supports exactly typeSite, manualMembership,
 *     membershipRestriction, accessToControlMenuRoleNames and
 *     showControlMenuByRole
 *   - nowhere in the class is a group's friendly URL set; it fetches the group
 *     rather than creating it
 *
 * So Liferay derives it from the siteName in client-extension.yaml, and the
 * only way to change it is to rename the site. This binds the two ends
 * together: rename the site and this fails, rather than the suite silently
 * spending five minutes on the Guest page.
 *
 * The 404 was never the visible symptom either. The helper fell back to
 * /web/guest without comment, where the component has no site context:
 *
 *     404 - https://aica-e2e.demo/web/aica
 *     >>> Falling back to Guest page...
 *     404 - https://aica-e2e.demo/web/undefined
 *
 * which points at the frontend rather than at a missing site.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const clientExtension = fs.readFileSync(
  path.join(
    ROOT,
    'client-extensions',
    'ai-commerce-accelerator-site-initializer',
    'client-extension.yaml'
  ),
  'utf8'
);
const helper = fs.readFileSync(
  path.join(ROOT, 'playwright', 'tests', 'e2e', 'test-helper.js'),
  'utf8'
);

// Liferay's friendly-URL normalisation, for the shapes a site name takes:
// lower-cased, runs of non-alphanumerics collapsed to a single hyphen.
function derivedPath(siteName) {
  return `/web/${siteName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

const siteName = clientExtension.match(/^\s+siteName:\s*(.+)$/m)?.[1].trim();
const sitePaths = [...helper.matchAll(/'(\/web\/[^']+)'/g)].map((m) => m[1]);

describe('the tests ask for the URL the site actually has', () => {
  it('reads a siteName to derive it from', () => {
    expect(siteName).toBe('AI Commerce Accelerator');
  });

  it('tries the derived URL first', () => {
    // Binds the two ends. Renaming the site fails this, instead of the suite
    // quietly running against Guest.
    expect(sitePaths[0]).toBe(derivedPath(siteName));
  });

  it('keeps /web/aica as a second attempt', () => {
    // It cannot be declared, but it can still be set through the UI or API,
    // and a suite that knows only one of the two fails the way this one did.
    expect(sitePaths).toContain('/web/aica');
  });

  it('does not claim a friendly URL the site initializer would ignore', () => {
    // site-initializer.json has no site-level friendlyURL. Adding one looks
    // like a fix and changes nothing - the failure mode this whole run has
    // been about.
    const siteInitializer = JSON.parse(
      fs.readFileSync(
        path.join(
          ROOT,
          'client-extensions',
          'ai-commerce-accelerator-site-initializer',
          'site-initializer',
          'site-initializer.json'
        ),
        'utf8'
      )
    );

    expect(siteInitializer.friendlyURL).toBeUndefined();
  });
});

describe('a site that cannot be reached says so', () => {
  it('calls the Guest fallback a degradation, not a detail', () => {
    expect(helper).toMatch(/DEGRADED/);
    expect(helper).toMatch(/no site context/);
  });

  it('names what to fix rather than leaving the reader to guess', () => {
    expect(helper).toMatch(/fix the site URL rather than these tests/);
  });

  it('reports when it lands somewhere other than the derived URL', () => {
    expect(helper).toMatch(/no longer matches the siteName it is derived from/);
  });
});
