const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '../../../scripts/detect-secrets.mjs');

/**
 * The environment every child here runs with, minus git's own variables.
 *
 * git exports `GIT_DIR`, `GIT_INDEX_FILE` and `GIT_WORK_TREE` to its hooks, and
 * `GIT_DIR` OVERRIDES cwd-based discovery - so `{ cwd: repo }` is not enough to
 * keep a git command inside the sandbox. `.husky/pre-push` runs `yarn test`,
 * which means that without this every `git` call below, and every call the
 * script under test makes, would run against the developer's real repository:
 * `git add .` and `git commit` of their working tree, then `git branch -M
 * base-branch` renaming whatever they were on (#1033).
 *
 * It was not hypothetical - it happened during #1022, leaving a renamed branch,
 * a commit nobody asked for and four staged files.
 *
 * The script's own `execSync` inherits this too, which is why `runCheck` takes
 * it as well: pointed at the real repository it would read that repository's
 * diff, and the assertions below would be reporting on the wrong thing rather
 * than merely doing damage.
 *
 * Computed per call rather than once at module load, so the guard below can set
 * GIT_DIR and actually observe it being dropped. Frozen at load it would be
 * untestable, and a test that cannot fail is what this file is for.
 */
function sandboxEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
  );
}

/**
 * The secrets check ran in exactly one place - the pre-commit hook - and that
 * place is skippable with `--no-verify`, which worktree work does routinely
 * because a fresh worktree has no node_modules for lint-staged. Nothing scanned
 * a pull request (#1001).
 *
 * It could not simply be added to CI: it read `git diff --cached`, and on a
 * runner nothing is staged, so it reported "no staged files" and exited zero. A
 * green tick over an empty set is worse than no check, because a green tick is
 * read as evidence.
 *
 * So the selection is now a choice, and the test that matters is the last one:
 * that the check actually FAILS on a planted secret in the mode CI uses. The
 * rest is argument handling.
 */

describe('detect-secrets: choosing what to scan (#1001)', () => {
  let selectionFor;

  beforeAll(async () => {
    ({ selectionFor } = await import(`file://${SCRIPT}`));
  });

  it('defaults to the index, so the commit hook is unchanged', () => {
    const selection = selectionFor([]);

    expect(selection.command).toContain('--cached');
    expect(selection.describe).toBe('staged files');
  });

  it('scans a range when given one', () => {
    const selection = selectionFor(['--range', 'main...HEAD']);

    expect(selection.command).toContain('git diff main...HEAD');
    expect(selection.command).not.toContain('--cached');
    expect(selection.range).toBe('main...HEAD');
  });

  it('accepts --range=VALUE', () => {
    expect(selectionFor(['--range=main...HEAD']).range).toBe('main...HEAD');
  });

  // The empty message names the range, so a CI log says what was examined
  // rather than implying the whole tree was.
  it('says which range found nothing', () => {
    expect(selectionFor(['--range', 'a...b']).emptyMessage).toContain('a...b');
  });
});

describe('detect-secrets: it actually fails on a planted secret (#1001)', () => {
  let repo;

  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: sandboxEnv(),
    });

  // The script reads file contents from `path.resolve(__dirname, '..')`, not
  // from the working directory, so a copy has to live inside the sandbox for
  // its root to be the sandbox. Copying its own bytes also means the code under
  // test is the code that ships.
  const runCheck = (...args) => {
    const sandboxed = path.join(repo, 'scripts', 'detect-secrets.mjs');

    fs.mkdirSync(path.dirname(sandboxed), { recursive: true });
    fs.copyFileSync(SCRIPT, sandboxed);

    try {
      const stdout = execFileSync('node', [sandboxed, ...args], {
        cwd: repo,
        encoding: 'utf8',
        env: sandboxEnv(),
      });
      return { status: 0, stdout };
    } catch (error) {
      return {
        status: error.status,
        stdout: `${error.stdout || ''}${error.stderr || ''}`,
      };
    }
  };

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-range-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(repo, 'README.md'), '# base\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('branch', '-M', 'base-branch');
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  // Assembled rather than written out, so this fixture cannot trip the very
  // check it is testing when the repository scans itself.
  const plantedKey = () => 'sk-' + 'a'.repeat(40);

  it('fails on a secret added in the range', () => {
    git('checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(repo, 'leak.txt'), `key = ${plantedKey()}\n`);
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'add a key');

    const { status, stdout } = runCheck('--range', 'base-branch...HEAD');

    expect(status).toBe(1);
    expect(stdout).toMatch(/OpenAI API Key|leak\.txt/);
  });

  // The case that made the check unusable in CI: nothing staged, so the old
  // behaviour reported success without examining the branch at all.
  it('the default mode passes over the same commit, which is why range exists', () => {
    git('checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(repo, 'leak.txt'), `key = ${plantedKey()}\n`);
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'add a key');

    const { status, stdout } = runCheck();

    expect(status).toBe(0);
    expect(stdout).toMatch(/No staged files/);
  });

  // The reason `sandboxEnv` exists. Running under a hook, git hands the child
  // GIT_DIR, and GIT_DIR beats `cwd` - so without scrubbing it these commands
  // would leave the sandbox entirely and operate on whatever repository the
  // hook was invoked from. Here that is a second scratch repository, which is
  // the same mechanism with somewhere harmless to land: with the scrub, the
  // planted secret is still found in the sandbox; without it, the sandbox never
  // receives the commits and the range finds nothing (#1033).
  it('stays in the sandbox when git hands it a GIT_DIR, as a hook does', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-hook-'));

    execFileSync('git', ['init', '-q'], { cwd: elsewhere, encoding: 'utf8' });

    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(elsewhere, '.git');

    try {
      git('checkout', '-q', '-b', 'feature');
      fs.writeFileSync(path.join(repo, 'leak.txt'), `key = ${plantedKey()}\n`);
      git('add', '.');
      git('commit', '-q', '--no-verify', '-m', 'add a key');

      const { status, stdout } = runCheck('--range', 'base-branch...HEAD');

      expect(status).toBe(1);
      expect(stdout).toMatch(/OpenAI API Key|leak\.txt/);
    } finally {
      if (previous === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = previous;
      }

      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('passes a clean range', () => {
    git('checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(repo, 'fine.txt'), 'nothing to see\n');
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'clean');

    expect(runCheck('--range', 'base-branch...HEAD').status).toBe(0);
  });

  // A range that does not resolve must not pass quietly - that would restore
  // the empty-set green tick by another route.
  it('fails on an unresolvable range rather than passing', () => {
    expect(runCheck('--range', 'no-such-ref...HEAD').status).toBe(1);
  });

  it('refuses --range with no value', () => {
    expect(runCheck('--range').status).toBe(2);
  });
});
