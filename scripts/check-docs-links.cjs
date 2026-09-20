#!/usr/bin/env node

// `yarn lint:md` checks markdown style, not whether the documentation is true.
//
// markdownlint passed clean on this repository while all of the following were
// live: four links in `docs/LOCAL_EXECUTION.md` pointed at
// `file:///Users/<someone>/dev/repos/...`, which resolve for exactly one person
// and leak a local path to everyone else; three cross-repository links pointed
// at `liferay-docker-manager` paths that had 404'd since that repository moved
// to a Diataxis layout; the five substantial documents under `docs/architecture/`
// were reachable from no index, not even from `docs/ARCHITECTURE.md` directly
// above them; and both `.markdownlintignore` and the `lint:md` script still
// excluded `GETTING_STARTED.md`, deleted in #244. See #1057.
//
// None of those are style problems, so no style linter could have caught them.
// Each check below therefore asserts a CLASS of defect rather than the instance
// that prompted it - "no link anywhere may point at an absolute local path",
// not "LOCAL_EXECUTION.md is clean" - so that a recurrence in a file that does
// not exist yet still fails the gate.
//
// Anchors are slugified the way GitHub does it, because GitHub renders this
// corpus: there is no static site generator. If one is ever added, note that a
// heading containing an emoji slugifies differently in most generators, so a
// linked heading can be correct on one renderer or the other but not both. The
// fix then is removing the emoji from the linked heading, not choosing a side.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

const fail = (check, file, detail) => failures.push({ check, file, detail });

function trackedMarkdown() {
  return execFileSync('git', ['ls-files', '*.md', '*.mdx'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

// GitHub's slugifier: lowercase, drop everything that is not alphanumeric,
// space, hyphen or underscore (this is the step that removes emoji), then
// spaces become hyphens. Repeated headings get `-1`, `-2`, ... suffixes.
function slug(text) {
  const cleaned = text
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .toLowerCase();
  return Array.from(cleaned)
    .filter((c) => /[a-z0-9 \-_]/.test(c))
    .join('')
    .replace(/ /g, '-');
}

function headingsOf(src) {
  const seen = new Map();
  const out = new Set();
  let inFence = false;
  for (const line of src.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[2]);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

// Fenced code blocks hold illustrative links that are not meant to resolve.
const stripFences = (src) => src.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, '');

const LINK = /(?<!!)\[((?:[^[\]]|\[[^\]]*\])*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const files = trackedMarkdown();
const headingCache = new Map();
function headings(rel) {
  if (!headingCache.has(rel)) {
    let set = new Set();
    try {
      set = headingsOf(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    } catch {
      // unreadable target is reported by the existence check instead
    }
    headingCache.set(rel, set);
  }
  return headingCache.get(rel);
}

const linksFrom = new Map();

for (const file of files) {
  const body = stripFences(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const dir = path.dirname(file);
  const outgoing = new Set();

  for (const [, label, target] of body.matchAll(LINK)) {
    // 1. An absolute local path resolves only on the machine that wrote it.
    if (/^file:\/\//i.test(target) || /^\/(Users|home)\//.test(target)) {
      fail('no-absolute-local-link', file, `[${label}] -> ${target}`);
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http, mailto, ...

    if (target.startsWith('#')) {
      const anchor = target.slice(1).toLowerCase();
      if (anchor && !headings(file).has(anchor)) {
        fail('anchor-resolves', file, `[${label}] -> ${target}`);
      }
      continue;
    }

    const [rawPath, anchor] = target.split('#');
    if (!rawPath) continue;
    const resolved = rawPath.startsWith('/')
      ? path.join(ROOT, rawPath)
      : path.resolve(ROOT, dir, rawPath);

    // 2. The target has to exist.
    if (!fs.existsSync(resolved)) {
      fail('relative-link-resolves', file, `[${label}] -> ${target}`);
      continue;
    }

    const rel = path.relative(ROOT, resolved);
    outgoing.add(rel);

    // 3. And so does the heading the anchor names.
    if (
      anchor &&
      /\.mdx?$/.test(rel) &&
      !headings(rel).has(anchor.toLowerCase())
    ) {
      fail('anchor-resolves', file, `[${label}] -> ${target}`);
    }
  }
  linksFrom.set(file, outgoing);
}

// 4. A page nothing links to is a page nobody finds. Walk outward from the
//    landing pages and require every docs/ page to be reachable.
const LANDING = [
  'README.md',
  'docs/README.md',
  'docs/architecture/README.md',
  'docs/upstream-bugs/index.md',
];
const reachable = new Set();
const queue = LANDING.filter((f) => fs.existsSync(path.join(ROOT, f)));
queue.forEach((f) => reachable.add(f));
while (queue.length) {
  for (const next of linksFrom.get(queue.shift()) || []) {
    if (!reachable.has(next)) {
      reachable.add(next);
      queue.push(next);
    }
  }
}
for (const file of files) {
  if (!file.startsWith('docs/') || !/\.mdx?$/.test(file)) continue;
  if (!reachable.has(file)) {
    fail('no-orphan-doc', file, 'not reachable from any landing page');
  }
}

// 5. An exclusion for a file that no longer exists silently widens over time.
//    Directory entries are skipped: they are build output and are legitimately
//    absent from a fresh clone.
function checkIgnoreEntry(entry, source) {
  if (
    !entry ||
    entry.startsWith('#') ||
    entry.includes('*') ||
    entry.endsWith('/')
  )
    return;
  if (!fs.existsSync(path.join(ROOT, entry))) {
    fail('no-dead-lint-ignore', source, `${entry} does not exist`);
  }
}
const ignoreFile = path.join(ROOT, '.markdownlintignore');
if (fs.existsSync(ignoreFile)) {
  for (const line of fs.readFileSync(ignoreFile, 'utf8').split('\n')) {
    checkIgnoreEntry(line.trim(), '.markdownlintignore');
  }
}
const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
);
for (const [, entry] of (pkg.scripts?.['lint:md'] || '').matchAll(
  /--ignore\s+'([^']+)'/g
)) {
  checkIgnoreEntry(entry, 'package.json (lint:md)');
}

if (failures.length) {
  const byCheck = new Map();
  for (const f of failures) {
    if (!byCheck.has(f.check)) byCheck.set(f.check, []);
    byCheck.get(f.check).push(f);
  }
  console.error(`\nDocumentation integrity: ${failures.length} problem(s)\n`);
  for (const [check, items] of byCheck) {
    console.error(`  ${check} (${items.length})`);
    for (const i of items) console.error(`    ${i.file}: ${i.detail}`);
    console.error('');
  }
  process.exit(1);
}

console.log(`Documentation integrity: OK (${files.length} files checked)`);
