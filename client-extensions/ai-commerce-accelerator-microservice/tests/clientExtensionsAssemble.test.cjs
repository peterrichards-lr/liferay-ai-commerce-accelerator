const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

/**
 * Every client extension must actually assemble something (#1164).
 *
 * `runtimeAssetsAssembled.test.cjs` guards the microservice, which is the only
 * extension with a filesystem at runtime. The rest fail the same way for a
 * different reason: an `assemble` block naming a directory that is not there,
 * or a new extension with no `assemble` block at all. Both ship an empty
 * extension, and both are silent - Liferay deploys it, the zip is valid, and
 * nothing in the source tree has moved.
 *
 * This lives in the microservice's suite because it is the only one that runs.
 * It reaches up to the repository root deliberately, as sharedOsgiPin does.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CX_ROOT = path.join(REPO_ROOT, 'client-extensions');

// Types whose whole directory ships, so declaring `assemble` would be wrong.
// A siteInitializer is a directory layout that Liferay reads entire.
const SHIPS_WHOLE_DIRECTORY = new Set(['siteInitializer']);

// Files that configure the build rather than being shipped by it, so their
// presence does not mean an extension has a payload to assemble.
const METADATA = new Set([
  'client-extension.yaml',
  'LCP.json',
  'package.json',
  'README.md',
  '.gitignore',
]);

const extensions = fs
  .readdirSync(CX_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((name) =>
    fs.existsSync(path.join(CX_ROOT, name, 'client-extension.yaml'))
  )
  .sort();

function manifestOf(name) {
  return YAML.parse(
    fs.readFileSync(path.join(CX_ROOT, name, 'client-extension.yaml'), 'utf8')
  );
}

// The `from` of an `assemble` entry is either a directory in the source tree
// or one the extension's own build emits. Rather than run the build, ask its
// configuration - esbuild's --outdir and vite's outDir both name it literally.
function isDeclaredBuildOutput(cxDir, from) {
  return ['package.json', 'vite.config.js', 'webpack.config.js']
    .map((f) => path.join(cxDir, f))
    .filter((f) => fs.existsSync(f))
    .some((f) => fs.readFileSync(f, 'utf8').includes(from));
}

describe('every client extension assembles something real (#1164)', () => {
  test('the scan found every extension', () => {
    // Five today. An empty or halved list would make every case below vacuous.
    expect(extensions.length).toBeGreaterThanOrEqual(5);
    expect(extensions).toContain('ai-commerce-accelerator-microservice');
    expect(extensions).toContain('ai-commerce-accelerator-site-initializer');
  });

  test.each(extensions)('%s declares how it is assembled', (name) => {
    const manifest = manifestOf(name);
    if (Array.isArray(manifest.assemble) && manifest.assemble.length > 0)
      return;

    // No `assemble`: every declared type must be one that ships entire.
    const types = Object.values(manifest)
      .filter((v) => v && typeof v === 'object' && v.type)
      .map((v) => v.type);

    expect(types.length).toBeGreaterThan(0);
    if (types.some((t) => SHIPS_WHOLE_DIRECTORY.has(t))) return;

    // Neither assembled nor shipped entire, which is correct only if there is
    // nothing to ship. A manifest of OAuth applications is a real extension
    // with no payload; a directory of source beside it is a defect. Metadata
    // is excluded because it configures the build rather than being shipped by
    // it.
    const payload = fs
      .readdirSync(path.join(CX_ROOT, name))
      .filter((f) => !METADATA.has(f) && f !== 'node_modules');

    expect(
      payload,
      `${name} has no 'assemble' block and no type that ships its directory ` +
        `entire, yet it holds ${payload.join(', ')}. That will not be ` +
        `deployed.`
    ).toEqual([]);
  });

  test.each(extensions)('%s assembles from somewhere that exists', (name) => {
    const cxDir = path.join(CX_ROOT, name);
    const entries = manifestOf(name).assemble || [];

    for (const entry of entries) {
      if (!entry.from) continue; // `include:` form, guarded per-file elsewhere.

      const source = path.join(cxDir, entry.from);
      const present =
        fs.existsSync(source) && fs.readdirSync(source).length > 0;

      expect(
        present || isDeclaredBuildOutput(cxDir, entry.from),
        `${name} assembles from '${entry.from}', which is neither a non-empty ` +
          `directory nor named by its build configuration. A renamed or ` +
          `removed source directory ships an empty extension silently.`
      ).toBe(true);
    }
  });
});
