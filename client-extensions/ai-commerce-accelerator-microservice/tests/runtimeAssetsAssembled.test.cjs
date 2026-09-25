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

/**
 * The read-to-assembled rule (#1164).
 *
 * The lists above catch a regression in an asset someone already thought
 * about. They cannot catch the way this keeps happening: an asset added, read
 * from the source tree by a passing test, and never named by a glob.
 * `prompts/*.md` is the case that proves it - six months after #1131 widened
 * `assemble` for five trees, a sixth was still missing, and a zip built from
 * master carried nine schemas, six public files and zero prompts (#1166).
 *
 * So this derives the question from disk rather than from a list. `**\/*.cjs`
 * covers the code; every other file is an asset that ships only if a glob
 * names it. Any directory holding one, and referenced from non-test source,
 * must be assembled in full.
 *
 * A new asset directory, or a new extension inside an assembled one
 * (`generation-schemas/*.json` does not match a `.yaml`), fails here.
 */
const WALK_EXCLUDED = new Set([
  'node_modules',
  'tests',
  'dist',
  'build',
  'coverage',
  'logs',
  '.git',
]);

function filesUnder(dir, predicate, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (WALK_EXCLUDED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, predicate, base, out);
    else if (predicate(entry.name)) out.push(path.relative(base, full));
  }
  return out;
}

const isAsset = (name) => !name.endsWith('.cjs');

// Assets that are deliberately not shipped, each with the reason. A list
// rather than a pattern: `prompts/*.md` and `data/README.md` are both markdown
// in an asset directory, and only one of them is read at runtime. Excluding
// documentation by extension would have excluded every prompt too, which is
// exactly the defect this file exists to catch (#1166).
const NOT_SHIPPED = new Map([
  ['data/README.md', 'documentation for the two fixtures beside it'],
]);

// Top-level directories that hold at least one asset.
const assetDirectories = fs
  .readdirSync(CX_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !WALK_EXCLUDED.has(e.name))
  .map((e) => e.name)
  .filter((name) => filesUnder(path.join(CX_ROOT, name), isAsset).length > 0)
  .sort();

// Non-test source, so a failure can name the reader rather than only the file.
const sourceFiles = filesUnder(CX_ROOT, (n) => n.endsWith('.cjs'));

function readersOf(dirName) {
  const mention = new RegExp(`['"\`/]${dirName}['"\`/]`);
  return (
    sourceFiles
      .filter((relative) =>
        mention.test(fs.readFileSync(path.join(CX_ROOT, relative), 'utf8'))
      )
      // `scripts/` is developer tooling and runs from a checkout, so it is the
      // least useful name to put in the message even though the walk reaches
      // it first. Server code answers "why does the container need this".
      .sort(
        (a, b) =>
          Number(a.startsWith(`scripts${path.sep}`)) -
            Number(b.startsWith(`scripts${path.sep}`)) || a.localeCompare(b)
      )
  );
}

describe('every asset directory the code reads is assembled (#1164)', () => {
  test('the scan finds the directories it is supposed to', () => {
    // If this list ever empties - a bad walk, a moved root - every case below
    // would pass by finding nothing. #1073's lesson: assert the guard has
    // something to guard.
    expect(assetDirectories).toEqual(
      expect.arrayContaining([
        'data',
        'generation-schemas',
        'prompts',
        'public',
        'resources',
      ])
    );
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  test.each([...NOT_SHIPPED])(
    'the exemption for %s is still a real file (%s)',
    (file) => {
      // A stale exemption is a hole. If the file goes, the entry must go too.
      expect(fs.existsSync(path.join(CX_ROOT, file))).toBe(true);
      expect(isAssembled(file)).toBe(false);
    }
  );

  test.each(assetDirectories)('%s', (dirName) => {
    const readers = readersOf(dirName);
    if (readers.length === 0) return; // Not read; shipping it is another call.

    const missing = filesUnder(path.join(CX_ROOT, dirName), isAsset)
      .map((f) => path.posix.join(dirName, f.split(path.sep).join('/')))
      .filter((f) => !isAssembled(f) && !NOT_SHIPPED.has(f));

    expect(
      missing,
      `${dirName}/ is read by ${readers.slice(0, 3).join(', ')} but these ` +
        `files are not assembled, ` +
        `so they will not exist in the container:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });
});
