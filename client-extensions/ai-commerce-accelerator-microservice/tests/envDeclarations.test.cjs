const fs = require('fs');
const path = require('path');
const { ENV } = require('../utils/constants.cjs');

/**
 * Every `ENV.NAME` read has a declaration behind it.
 *
 * The inverse defect is silent by construction. `objectStorageService.cjs` read
 * `ENV.PUBLIC_OBJECT_SEARCH_PATHS` and `ENV.PRIVATE_OBJECT_DIR`, neither of
 * which was ever declared. `ENV` is a plain object rather than a proxy over
 * `process.env`, so both were permanently `undefined` - and the guard below
 * each one then told the operator to set the variable they had just set. There
 * was no value of those variables that could work (#1063).
 *
 * Reading either file alone showed nothing wrong: the read and its error
 * message were entirely consistent, and only the absent declaration in a third
 * file made it a bug. That is what this asserts, as a class rather than for
 * those two names - a new undeclared read anywhere fails here.
 *
 * Only `ENV.NAME` needs checking because that is the only shape used: there is
 * no destructuring of ENV, no spread, and the single dynamic `ENV[expr]` site
 * (`configService.getAIKey`) draws from `PROVIDER_ENV_VARS`, whose values are
 * the three provider key names, all declared.
 */
const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set([
  'node_modules',
  'build',
  'coverage',
  'dist',
  'logs',
  'tests',
  'public',
]);

// Undeclared reads that predate this check. Each is inert rather than broken -
// every one has a working fallback at the point of use, so the setting simply
// cannot be configured rather than failing loudly the way #1063 did. Tracked
// in #1068; this list exists so the check can guard everything else today
// instead of waiting for them.
//
// The second case below keeps it from becoming a permanent excuse: an entry
// that no longer matches an undeclared read fails, so fixing one forces its
// removal from this list rather than leaving a stale allowance behind.
const KNOWN_UNDECLARED = new Set([
  'CACHE_MAX_SIZE',
  'CACHE_DEFAULT_TTL',
  'CACHE_CLEANUP_INTERVAL',
  'CONFIG_CACHE_TTL',
  'PROMPTS_DIR',
  'PROMPT_CACHE_TTL',
  'PROMPT_CACHE_DISABLED',
]);

function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) sourceFiles(full, acc);
    } else if (/\.(cjs|mjs|js)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

// Comments are stripped before scanning, because prose about a setting is not
// a read of it. Without this a comment naming `ENV.SOMETHING` counts as usage:
// it would keep an entry in KNOWN_UNDECLARED looking live after the real read
// was gone - which is exactly what a comment added by the #1070 fix did - and
// could equally fail the check for a name only ever discussed. See #1072.
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (quote) {
      if (c === '\\') {
        out += c + (next ?? '');
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

function undeclaredReads() {
  const declared = new Set(Object.keys(ENV));
  const found = new Map();

  for (const file of sourceFiles(ROOT)) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));

    for (const [, name] of src.matchAll(/\bENV\.([A-Z][A-Z0-9_]*)\b/g)) {
      if (!declared.has(name)) {
        found.set(name, `${path.relative(ROOT, file)}: ENV.${name}`);
      }
    }
  }

  return found;
}

describe('ENV declarations (#1063)', () => {
  it('declares every setting the source reads', () => {
    const offenders = [...undeclaredReads()]
      .filter(([name]) => !KNOWN_UNDECLARED.has(name))
      .map(([, where]) => where);

    expect(offenders).toEqual([]);
  });

  it('keeps no allowance for a read that has since been declared', () => {
    const stillUndeclared = undeclaredReads();
    const stale = [...KNOWN_UNDECLARED].filter((n) => !stillUndeclared.has(n));

    expect(stale).toEqual([]);
  });

  it('scans a corpus large enough for that to mean something', () => {
    // A guard that silently stops finding files passes forever. This fails if
    // the walk breaks or the skip list grows to swallow the source.
    const files = sourceFiles(ROOT);
    const withReads = files.filter((f) =>
      /\bENV\.[A-Z]/.test(fs.readFileSync(f, 'utf8'))
    );

    expect(files.length).toBeGreaterThan(50);
    expect(withReads.length).toBeGreaterThan(10);
  });
});
