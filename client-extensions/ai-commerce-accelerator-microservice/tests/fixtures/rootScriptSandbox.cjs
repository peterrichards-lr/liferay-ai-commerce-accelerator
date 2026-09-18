const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * The ambient environment minus git's own variables.
 *
 * git exports `GIT_DIR`, `GIT_INDEX_FILE` and `GIT_WORK_TREE` to its hooks, and
 * a git worktree exports them too — and `GIT_DIR` OVERRIDES cwd-based
 * discovery. So `{ cwd: dir }` is not enough to keep a command inside the
 * sandbox: without this, `yarn test` stages files in whatever repository the
 * caller is sitting in (#1050, and #1033 before it).
 *
 * Computed per call rather than once at module load, so a test can set GIT_DIR
 * and observe it being dropped. Frozen at load it would be untestable, which in
 * a guard against exactly this would be the wrong trade.
 */
function sandboxEnv(extra = {}) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
    ),
    ...extra,
  };
}

/**
 * The repository's gating checks - `check-lockfile-drift.cjs`,
 * `check-duplicate-json-keys.cjs`, `validate-cx.js`, `detect-secrets.mjs` -
 * are scripts, not modules. Each one runs on load, exports nothing, and
 * resolves everything it reads from `path.resolve(__dirname, '..')`, so there
 * is no seam to require and no argument that points it at a tree of the
 * caller's choosing (#978).
 *
 * Copying the script's own bytes into a throwaway tree gives it one: the
 * script's `__dirname` becomes `<sandbox>/scripts`, so its root becomes the
 * sandbox. The file under test is the file that ships - a re-implementation
 * would pass while the real check rotted, which is the failure the issue is
 * about.
 */

// Every path this module writes to is one it has just created under mkdtemp, so
// the non-literal filename the rule objects to is the point of the module.
/* eslint-disable security/detect-non-literal-fs-filename */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

/**
 * An ESM script's bare `import` cannot be redirected with NODE_PATH the way a
 * CommonJS one can, so `validate-cx.js` finds `yaml` only if the sandbox has a
 * `node_modules` holding it. Each package the script under test imports is
 * linked in by name; walking up for the nearest `node_modules` instead would
 * find the `.vite` cache vitest leaves in the workspace and link an empty tree.
 */
function linkDependencies(dir, packages) {
  if (!packages.length) return;

  const marker = `${path.sep}node_modules${path.sep}`;

  for (const name of packages) {
    const entry = require.resolve(name);
    const installed = path.join(
      entry.slice(0, entry.lastIndexOf(marker) + marker.length),
      name
    );
    const link = path.join(dir, 'node_modules', name);

    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(installed, link, 'dir');
  }
}

function materialise(dir, files) {
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(dir, relative);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof contents === 'string'
        ? contents
        : `${JSON.stringify(contents, null, 2)}\n`
    );
  }
}

function createSandbox(scriptName, files = {}, { dependencies = [] } = {}) {
  // macOS resolves os.tmpdir() through a symlink, and a script that compares
  // its own resolved paths against the tree it walked would disagree with
  // itself.
  const dir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), 'aica-root-script-')
  );

  materialise(dir, files);

  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(SCRIPTS_DIR, scriptName),
    path.join(dir, 'scripts', scriptName)
  );

  linkDependencies(dir, dependencies);

  return {
    dir,

    write(files) {
      materialise(dir, files);
    },

    git(...args) {
      return execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf8',
        env: sandboxEnv(),
      });
    },

    run() {
      const result = spawnSync(
        process.execPath,
        [path.join(dir, 'scripts', scriptName)],
        {
          cwd: dir,
          encoding: 'utf8',
          env: sandboxEnv({ FORCE_COLOR: '0', NO_COLOR: '1' }),
        }
      );

      return {
        status: result.status,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        output: `${result.stdout || ''}${result.stderr || ''}`,
      };
    },

    dispose() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { REPO_ROOT, SCRIPTS_DIR, createSandbox, sandboxEnv };
