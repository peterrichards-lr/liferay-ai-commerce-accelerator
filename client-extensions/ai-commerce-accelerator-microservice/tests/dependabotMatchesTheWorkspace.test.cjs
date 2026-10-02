const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

/**
 * Dependabot must be able to produce a PR that can merge.
 *
 * This is a yarn workspaces monorepo with a single `yarn.lock`. Dependabot
 * runs per-directory, so an ecosystem declared for a workspace directory can
 * only touch that directory's `package.json` — there is no lockfile there and
 * it will not reach the root one. Three such ecosystems were declared and
 * produced nine PRs that failed `check-lockfile-drift.cjs` every week, and
 * none of the ten carried `no-issue-needed`, so they failed the issue-link
 * check too. See #1231.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');

const config = () =>
  YAML.parse(
    fs.readFileSync(path.join(ROOT, '.github', 'dependabot.yml'), 'utf8')
  );

const rootPackage = () =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const npmEcosystems = () =>
  config().updates.filter((u) => u['package-ecosystem'] === 'npm');

describe('dependabot matches the workspace layout (#1231)', () => {
  it('declares no npm ecosystem for a directory with no lockfile', () => {
    // The line whose change turns this red: adding back a
    // `directory: /client-extensions/...` entry.
    const withoutLockfile = npmEcosystems()
      .map((u) => u.directory)
      .filter((dir) => {
        const lock = path.join(ROOT, dir.replace(/^\//, ''), 'yarn.lock');
        return !fs.existsSync(lock);
      });

    expect(withoutLockfile).toEqual([]);
  });

  it('covers every workspace from the root', () => {
    // Removing the per-directory entries is only safe because the root entry
    // reaches these. If a workspace were added outside the root's scope this
    // would be the place that noticed.
    const packages = rootPackage().workspaces.packages;

    expect(packages.length).toBeGreaterThan(0);
    expect(npmEcosystems().some((u) => u.directory === '/')).toBe(true);
  });

  it('labels its PRs so the issue-link check passes them', () => {
    // issue-link-check.yml fails a PR with no issue and no override label,
    // and its own help text names a dependabot bump as the case for this one.
    const labels = npmEcosystems()[0].labels || [];

    expect(labels).toContain('no-issue-needed');
  });

  it('keeps the labels dependabot applied by default', () => {
    // `labels:` REPLACES the defaults rather than adding to them, so omitting
    // these silently drops labelling that existed before.
    const labels = npmEcosystems()[0].labels || [];

    expect(labels).toContain('dependencies');
    expect(labels).toContain('javascript');
  });
});
