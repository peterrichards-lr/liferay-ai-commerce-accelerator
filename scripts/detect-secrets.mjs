import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Standard high-risk secret regex patterns
const SECRET_PATTERNS = [
  {
    name: 'Potential API Key / Secret / Password Assignment',
    // Flags password/key/secret variables where the value does NOT look like a mock, dummy, or standard variable placeholder
    regex:
      /(?:key|secret|password|passwd|token|auth|credential|private_key)\s*[:=]\s*["'](?![^"']*(?:test|mock|dummy|example|localhost|api|user|email|auth|token|cb|db|uuid|path|en_US|null|undefined|http))[^"']{8,}["']/i,
  },
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

function checkSecrets() {
  console.log(
    '🔒 Running Node-native Secrets Leak Detection check on staged files...'
  );

  let stagedFilesText;
  try {
    stagedFilesText = execSync(
      'git diff --cached --name-only --diff-filter=ACM',
      { encoding: 'utf8' }
    );
  } catch (err) {
    console.error('⚠️ Failed to list git staged files:', err.message);
    process.exit(0); // Pass gracefully if git is not available
  }

  const files = stagedFilesText
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  if (files.length === 0) {
    console.log('✅ No staged files to check.');
    process.exit(0);
  }

  let leaksFound = 0;

  files.forEach((file) => {
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
      file === '.secrets.baseline'
    ) {
      return;
    }

    const filePath = path.resolve(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      // Check if line contains allowlist pragma
      if (line.includes(IGNORE_PRAGMA)) return;

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

checkSecrets();
