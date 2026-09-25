const fs = require('node:fs');
const path = require('node:path');

/**
 * E2E specs must be authenticated by default, and must not hardcode a site
 * path.
 *
 * `auth.setup.js` wrote a storage state that the `desktop-chrome` project
 * never consumed: it declared `dependencies: ['setup']` but not
 * `use: { storageState }`. Authentication was therefore whatever each spec
 * remembered to ask for. Four asked; `smoke/full-journey.spec.js` did not, and
 * reached `/group/control_panel/manage` as a guest - a failure that reads as a
 * missing configuration section rather than a missing login.
 *
 * The same spec navigated to `/web/guest/ai-generator`: the wrong site, and a
 * page that does not exist (the site initializer declares `/data-generator`).
 * #1103 fixed the site path in `test-helper.js` and this copy stayed wrong,
 * which is the argument for one exported list rather than two literals.
 *
 * See #1150.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIG = path.join(ROOT, 'playwright', 'playwright-e2e.config.js');
const SPEC_DIR = path.join(ROOT, 'playwright', 'tests');

// Comments stripped before matching. The first version of this file failed on
// the comment in `full-journey.spec.js` that explains why `/web/guest/...` was
// wrong - a guard firing on prose about the defect it guards. #1073 is the
// same lesson: a check that counted comments as reads.
function codeOf(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
}

function specFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? specFiles(path.join(dir, e.name))
        : e.name.endsWith('.spec.js')
          ? [path.join(dir, e.name)]
          : []
    );
}

describe('E2E specs are authenticated by default (#1150)', () => {
  const config = fs.readFileSync(CONFIG, 'utf8');

  test('the desktop-chrome project consumes the storage state setup writes', () => {
    const project = config.slice(config.indexOf("name: 'desktop-chrome'"));
    expect(project).toMatch(/storageState/);
  });

  test('the state it names is the one auth.setup.js writes', () => {
    const setup = fs.readFileSync(
      path.join(SPEC_DIR, 'e2e', 'auth.setup.js'),
      'utf8'
    );
    // Both spell the same file; the setup builds it from __dirname, the config
    // names it relative to itself.
    expect(setup).toMatch(/\.auth\/user\.json/);
    expect(config).toMatch(/\.auth\/user\.json/);
  });

  // The hardcoded path that #1103 fixed in one place and not the other.
  test.each(specFiles(SPEC_DIR))(
    '%s does not hardcode a Guest site page',
    (f) => {
      const body = codeOf(f);
      // `/web/guest` alone is a legitimate degraded fallback in test-helper.
      // A *page beneath* it is the mistake: AICA's pages are not on Guest.
      expect(body).not.toMatch(/\/web\/guest\/[a-z]/i);
    }
  );

  test('the site paths are exported once, not copied', () => {
    const helper = fs.readFileSync(
      path.join(SPEC_DIR, 'e2e', 'test-helper.js'),
      'utf8'
    );
    expect(helper).toMatch(/export const AICA_SITE_PATHS/);

    // specFiles collects *.spec.js only, so the helper is never in this list -
    // the property is that no *spec* carries its own copy of the literal.
    const copies = specFiles(SPEC_DIR)
      .filter((f) => /\['\/web\/ai-commerce-accelerator'/.test(codeOf(f)))
      .map((f) => path.relative(SPEC_DIR, f));
    expect(copies).toEqual([]);
  });
});
