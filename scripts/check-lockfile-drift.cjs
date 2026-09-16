#!/usr/bin/env node

// `yarn install --frozen-lockfile` does not mean what it says on a workspace.
//
// Yarn 1 checks whether *it* would rewrite the lockfile, and an unsatisfied
// range in a member manifest does not require a rewrite - it resolves the new
// version, installs it nested under the member, and leaves the lockfile alone.
// Measured on this repository: with the microservice asking for vitest 4.1.11
// against a lockfile pinning 5.0.0, the frozen install exited 0, yarn.lock was
// untouched, and node_modules/vitest held 5.0.0 while the microservice's nested
// copy held 4.1.11 (#920).
//
// So `git diff --exit-code yarn.lock` after the install cannot catch this: the
// lockfile never moves. The artefact to check is the manifest against the
// lockfile's own keys, which yarn 1 writes as the literal `name@range` it was
// asked to resolve.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Ranges yarn resolves from the filesystem rather than the registry never get a
// lockfile entry, so their absence is not drift.
const UNLOCKED_PROTOCOLS = ['file:', 'link:', 'portal:', 'workspace:'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function lockfileKeys(lockfile) {
  const keys = new Set();

  for (const line of fs.readFileSync(lockfile, 'utf8').split('\n')) {
    if (!line || line.startsWith(' ') || line.startsWith('#')) continue;
    if (!line.endsWith(':')) continue;

    // One entry can satisfy several requested ranges:
    //   "foo@^1.0.0", "foo@^1.2.0":
    for (const key of line.slice(0, -1).split(',')) {
      keys.add(key.trim().replace(/^"|"$/g, ''));
    }
  }

  return keys;
}

function workspaceDirs(rootManifest) {
  const declared = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : rootManifest.workspaces?.packages || [];

  const missing = [];
  const present = [];

  for (const entry of declared) {
    // Globs are not expanded: this repository lists members explicitly, and a
    // guard that silently skips what it cannot understand is the kind of
    // vacuous check this script exists to replace.
    if (entry.includes('*')) {
      throw new Error(
        `workspaces entry "${entry}" is a glob; this check expects explicit paths`
      );
    }

    (fs.existsSync(path.join(ROOT, entry, 'package.json'))
      ? present
      : missing
    ).push(entry);
  }

  return { missing, present };
}

function main() {
  const rootManifest = readJson(path.join(ROOT, 'package.json'));
  const keys = lockfileKeys(path.join(ROOT, 'yarn.lock'));
  const { missing, present } = workspaceDirs(rootManifest);

  const problems = [];

  for (const entry of missing) {
    problems.push(
      `workspaces lists "${entry}", which has no package.json - a stale member ` +
        `silently changes what yarn hoists`
    );
  }

  const members = new Set(
    present.map((dir) => readJson(path.join(ROOT, dir, 'package.json')).name)
  );

  for (const dir of ['.', ...present]) {
    const manifest = readJson(path.join(ROOT, dir, 'package.json'));

    for (const section of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
    ]) {
      for (const [name, range] of Object.entries(manifest[section] || {})) {
        // A workspace member resolves to its sibling on disk, not the registry.
        if (members.has(name)) continue;
        if (UNLOCKED_PROTOCOLS.some((p) => range.startsWith(p))) continue;

        if (!keys.has(`${name}@${range}`)) {
          problems.push(
            `${path.join(dir, 'package.json')} asks for ${name}@${range}, ` +
              `which yarn.lock does not pin`
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error('❌ Lockfile does not describe the manifests:\n');
    for (const problem of problems) console.error(`   - ${problem}`);
    console.error(
      `\n   ${problems.length} problem(s). Run \`yarn install\` and commit the ` +
        `updated yarn.lock.\n`
    );
    process.exit(1);
  }

  console.log('✅ yarn.lock pins every range the manifests ask for.');
}

main();
