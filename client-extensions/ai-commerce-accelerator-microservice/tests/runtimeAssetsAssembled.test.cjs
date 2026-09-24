const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const picomatch = require('picomatch');

/**
 * Every asset the code reads at runtime must actually be assembled into the
 * client extension.
 *
 * `assemble` took `**\/*.cjs` and `package.json` only, so five runtime trees
 * never reached the container, and each failed differently and quietly:
 * `generation-schemas` ENOENT'd into a swallowed catch, leaving every
 * generated payload unvalidated with no truncation and no zero-item guard;
 * the mock media threw MODULE_NOT_FOUND from a bare require; the seed packs
 * answered HTTP 400 for every pack; `public/` 404'd; and `application.json`
 * took `allow.list` and the OAuth application references with it.
 *
 * None of it was visible to the existing tests, because they all read these
 * files from the source tree, where they have always been present. That is the
 * gap this closes: the question is not "is the file there" but "is it in what
 * we ship". See #1131.
 *
 * This models the manifest rather than running Gradle. The authoritative check
 * is the built zip - `unzip -Z1 dist/*.zip` - and a build on 2026-09-10 is
 * what confirmed all five were absent.
 */
const CX_ROOT = path.resolve(__dirname, '..');
const manifest = YAML.parse(
  fs.readFileSync(path.join(CX_ROOT, 'client-extension.yaml'), 'utf8')
);

const includes = (manifest.assemble || []).flatMap((e) => e.include || []);
const isAssembled = picomatch(includes, { dot: false });

// Files the code reads at runtime, each with the reader that proves it.
const REQUIRED = [
  ['application.json', "server.cjs reads lookupConfig('allow.list')"],
  ['generation-schemas/product.json', 'generationFacade.cjs:_loadSchemas'],
  ['generation-schemas/order.json', 'generationFacade.cjs:_loadSchemas'],
  ['data/mock-image.json', 'mediaGenerator.cjs:getMockBase64Image'],
  ['data/mock-pdf.json', 'mediaGenerator.cjs:getMockBase64Pdf'],
  [
    'resources/seed-packs/industrial-power-tools.json',
    'routes/generate.cjs seedPack',
  ],
  ['public/index.html', 'server.cjs res.sendFile'],
  ['public/placeholders/no_image_available.webp', 'routes/media.cjs'],
];

// Things that must NOT be shipped. A careless '**/*.json' would take all of
// these, putting test fixtures and a SQLite database into a customer image.
const FORBIDDEN = [
  'tests/lxcReadiness.test.cjs.json',
  'test.db',
  'vitest-report-microservice.xml',
  'coverage/index.html',
];

describe('runtime assets are assembled into the client extension (#1131)', () => {
  test.each(REQUIRED)('%s is assembled (%s)', (file) => {
    // Present in the source tree, or the expectation itself is stale.
    expect(fs.existsSync(path.join(CX_ROOT, file))).toBe(true);
    expect(isAssembled(file)).toBe(true);
  });

  test.each(FORBIDDEN)('%s is not assembled', (file) => {
    expect(isAssembled(file)).toBe(false);
  });

  // The directory is included by glob, so a schema added later is covered
  // without anyone remembering to update this file.
  test('every generation schema on disk is covered, not just the named ones', () => {
    const schemas = fs
      .readdirSync(path.join(CX_ROOT, 'generation-schemas'))
      .filter((f) => f.endsWith('.json'));
    expect(schemas.length).toBeGreaterThan(0);
    for (const s of schemas) {
      expect(isAssembled(`generation-schemas/${s}`)).toBe(true);
    }
  });
});
