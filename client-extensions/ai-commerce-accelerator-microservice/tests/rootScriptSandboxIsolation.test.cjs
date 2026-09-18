const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSandbox } = require('./fixtures/rootScriptSandbox.cjs');

/**
 * The sandbox must stay in its own directory even when git names another one.
 *
 * git exports GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE to its hooks, and a git
 * worktree exports them too — and GIT_DIR OVERRIDES cwd-based discovery, so
 * `{ cwd: dir }` is not enough. `.husky/pre-push` runs `yarn test`, so without
 * scrubbing them these fixtures operate on whatever repository the caller is
 * sitting in: running the suite left seven phantom files staged in the working
 * repository and blocked a rebase (#1050, and #1033 before it).
 *
 * Both children need it. `git()` passed no env at all; `run()` passed one built
 * by spreading `process.env`, which inherits GIT_DIR just the same — so anyone
 * reading `run()` as already safe fixes half of this.
 */

const gitIn = (dir, ...args) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

describe('the root-script sandbox ignores an ambient GIT_DIR', () => {
  let elsewhere;
  let previous;

  beforeEach(() => {
    elsewhere = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), 'aica-ambient-repo-')
    );

    gitIn(elsewhere, 'init', '-q');
    gitIn(elsewhere, 'config', 'user.email', 'test@example.com');
    gitIn(elsewhere, 'config', 'user.name', 'Test');

    previous = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(elsewhere, '.git');
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.GIT_DIR;
    } else {
      process.env.GIT_DIR = previous;
    }

    fs.rmSync(elsewhere, { recursive: true, force: true });
  });

  it('stages into its own repository, not the one GIT_DIR names', () => {
    const sandbox = createSandbox('detect-secrets.mjs', {
      'README.md': '# sandbox\n',
    });

    sandbox.git('init', '-q');
    sandbox.git('config', 'user.email', 'test@example.com');
    sandbox.git('config', 'user.name', 'Test');
    sandbox.git('add', '.');

    // The ambient repository must have seen none of that.
    const ambient = gitIn(elsewhere, 'status', '--porcelain');

    expect(ambient).toBe('');

    // And the sandbox must have seen all of it.
    const staged = sandbox.git('diff', '--cached', '--name-only');

    expect(staged).toContain('README.md');
  });

  it('runs the script under test against its own repository', () => {
    // `run()` spawns the script, which shells out to git itself. Pointed at the
    // ambient repository it reports on that one's diff, so the assertion has to
    // be one that can ONLY pass if it read the sandbox.
    //
    // A planted secret is that assertion. Asserting merely that the run exits 0
    // proves nothing: the ambient repository is empty, so a script reading it
    // finds nothing staged and exits 0 too - which is how the first version of
    // this test passed while `run()` was still inheriting GIT_DIR.
    //
    // Assembled rather than written out, so the fixture cannot trip the check
    // it is testing when the repository scans itself.
    const planted = 'sk-' + 'a'.repeat(40);

    const sandbox = createSandbox('detect-secrets.mjs', {
      'leak.txt': `key = ${planted}\n`,
    });

    sandbox.git('init', '-q');
    sandbox.git('config', 'user.email', 'test@example.com');
    sandbox.git('config', 'user.name', 'Test');
    sandbox.git('add', '.');

    const result = sandbox.run();

    // Found the secret, so it read the sandbox's index and not the empty one
    // GIT_DIR names.
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/leak\.txt|OpenAI/i);
    expect(gitIn(elsewhere, 'status', '--porcelain')).toBe('');
  });
});
