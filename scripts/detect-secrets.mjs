import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Standard high-risk secret regex patterns
const SECRET_PATTERNS = [
  {
    name: 'OpenAI API Key',
    regex: /sk-[a-zA-Z0-9]{32,}/,
  },
  {
    name: 'Gemini / Google API Key',
    regex: /AIzaSy[a-zA-Z0-9-_]{35}/,
  },
  {
    name: 'Anthropic API Key',
    regex: /sk-ant-sid01-[a-zA-Z0-9-_]{80,}/,
  },
  {
    name: 'Private SSH / SSL Key Header',
    regex: /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|PRIVATE)\s+PRIVATE\s+KEY-----/,
  },
  {
    name: 'AWS Access Key ID / Secret Access Key',
    regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|ASCA|ASIA)[A-Z0-9]{16}/,
  },
  {
    name: 'GitHub Personal Access Token',
    regex: /gh[opr]_[a-zA-Z0-9]{36,40}/,
  },
];

const IGNORE_PRAGMA = 'pragma: allowlist secret';

// Custom .gitleaksignore parser supporting file wildcards and literal token exclusions
function loadGitleaksIgnore() {
  const ignorePath = path.resolve(ROOT_DIR, '.gitleaksignore');
  if (!fs.existsSync(ignorePath)) return [];
  const content = fs.readFileSync(ignorePath, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * Which files to scan, and how to say so.
 *
 * The index is the right target for a commit hook and the wrong one everywhere
 * else: on a runner nothing is staged, so a check reading `--cached` reports
 * "no staged files" and exits zero. That is not a scan - it is a green tick
 * over an empty set, which is worse than no check at all, because a green tick
 * is read as evidence (#1001).
 *
 * `--range base...head` scans what a branch adds instead, which is what a pull
 * request needs. Absent, the behaviour is unchanged, so the hook keeps working
 * exactly as it did.
 */
export function selectionFor(argv) {
  const flag = argv.find((a) => a === '--range' || a.startsWith('--range='));

  if (!flag) {
    return {
      command: 'git diff --cached --name-only --diff-filter=ACM',
      describe: 'staged files',
      emptyMessage: 'No staged files to check.',
    };
  }

  const range = flag.includes('=')
    ? flag.slice('--range='.length)
    : argv[argv.indexOf(flag) + 1];

  if (!range) {
    console.error(
      '❌ --range needs a revision range, e.g. --range main...HEAD'
    );
    process.exit(2);
  }

  return {
    command: `git diff ${range} --name-only --diff-filter=ACM`,
    describe: `files changed in ${range}`,
    emptyMessage: `No files changed in ${range}.`,
    range,
  };
}

function checkSecrets(argv = process.argv.slice(2)) {
  const selection = selectionFor(argv);

  console.log(
    `🔒 Running Node-native Secrets Leak Detection check on ${selection.describe}...`
  );

  const ignoreRules = loadGitleaksIgnore();

  let stagedFilesText;
  try {
    stagedFilesText = execSync(selection.command, { encoding: 'utf8' });
  } catch (err) {
    // A range that does not resolve is a broken invocation, not an absent git.
    // Passing it silently would restore the empty-set green tick this exists
    // to remove.
    if (selection.range) {
      console.error(
        `❌ Could not list files for range '${selection.range}': ${err.message}`
      );
      process.exit(1);
    }

    console.error('⚠️ Failed to list git staged files:', err.message);
    process.exit(0); // Pass gracefully if git is not available
  }

  const files = stagedFilesText
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  if (files.length === 0) {
    console.log(`✅ ${selection.emptyMessage}`);
    process.exit(0);
  }

  let leaksFound = 0;

  files.forEach((file) => {
    // 1. Check if the file itself is globally ignored by a path pattern in .gitleaksignore
    const isFileIgnored = ignoreRules.some((rule) => {
      if (rule.includes('/') || rule.includes('*')) {
        const regexStr = rule
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*');
        const regex = new RegExp(`^${regexStr}$`);
        return regex.test(file);
      }
      return false;
    });

    if (isFileIgnored) {
      return;
    }

    // Skip binary files, lockfiles, or generator data templates
    if (
      file === 'yarn.lock' ||
      file === 'package-lock.json' ||
      file.endsWith('.png') ||
      file.endsWith('.webp') ||
      file.endsWith('.pdf') ||
      file.endsWith('.zip') ||
      file.includes('mocks/') ||
      file.includes('tests/') ||
      file.includes('scripts/') || // Skip local scratchpads
      file === '.secrets.baseline' ||
      file === '.gitleaksignore' // Skip the ignore file itself
    ) {
      return;
    }

    const filePath = path.resolve(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) return;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 2 * 1024 * 1024) return; // Skip files > 2MB
    } catch {
      return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      // Check if line contains inline allowlist pragma
      if (line.includes(IGNORE_PRAGMA)) return;

      // Check if line contains any of the literal ignored mock tokens/secrets from .gitleaksignore
      const isTokenIgnored = ignoreRules.some((rule) => {
        if (!rule.includes('/') && !rule.includes('*')) {
          return line.includes(rule);
        }
        return false;
      });

      if (isTokenIgnored) return;

      SECRET_PATTERNS.forEach((pattern) => {
        const match = line.match(pattern.regex);
        if (match) {
          const trimmed = line.trim();

          // Ignore commented lines
          if (
            trimmed.startsWith('//') ||
            trimmed.startsWith('#') ||
            trimmed.startsWith('/*') ||
            trimmed.startsWith('*')
          ) {
            return;
          }

          console.error(
            `\n❌ [${pattern.name}] leaked inside ${file} on line ${index + 1}:`
          );
          console.error(`   👉 \x1b[31m${trimmed}\x1b[0m`);
          console.error(
            `   💡 If this is a safe false-positive, append this comment at the end of the line: // ${IGNORE_PRAGMA}`
          );
          console.error(
            `   💡 Or register the mock value globally inside '.gitleaksignore' to allow it repo-wide.`
          );
          leaksFound++;
        }
      });
    });
  });

  if (leaksFound > 0) {
    console.error(
      `\n❌ \x1b[31mCommit Aborted!\x1b[0m Detected ${leaksFound} potential secrets leak(s).`
    );
    process.exit(1);
  } else {
    console.log('✅ No leaked secrets detected in staged files!');
    process.exit(0);
  }
}

// Importable without running. A module that scans and exits on load cannot be
// tested, which is how the file-selection half stayed uncovered while the
// pattern matching was covered (#1001).
//
// Compared through realpath on both sides: a plain string comparison is wrong
// wherever the invoking path differs from the real one - macOS resolves /var to
// /private/var - and would silently decline to run, leaving the hook passing
// without scanning anything.
let invokedDirectly = false;

try {
  invokedDirectly =
    Boolean(process.argv[1]) &&
    fs.realpathSync(process.argv[1]) ===
      fs.realpathSync(fileURLToPath(import.meta.url));
} catch {
  invokedDirectly = false;
}

if (invokedDirectly) {
  checkSecrets();
}
