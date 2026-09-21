const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Every LDM call must follow the target, and none may be captured with a
 * diagnostic mixed in.
 *
 * `ldm_cmd` appends `--node`, and its own comment records why that is injected
 * once rather than at each call site: "a target threaded through call sites
 * individually, where each one has to remember". Two calls did not remember.
 *
 *   other_running_ldm_projects()  ldm list --json
 *   the credential lookup         ldm info "$PROJECT" --credentials --json
 *
 * Both fail silently on a remote target, and both fail *usefully wrong*. The
 * first is the concurrency check: asking this host about a remote run always
 * answers "nothing is running", so the guard passes by construction. The
 * second falls through to a default login, so Playwright fails every spec at
 * the login form - which reads as an application defect, not a configuration
 * one.
 *
 * Both capture the output, so a [CMD] line on stdout would make the JSON
 * unparseable and produce exactly the same silent fallbacks. log_command
 * writes to stderr for that reason, and that has its own case.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const source = fs.readFileSync(SCRIPT, 'utf8');

describe('every LDM call follows the target', () => {
  it('leaves no bare `ldm <subcommand>` that should have been ldm_cmd', () => {
    // The class, not the two instances. Exempt, with reasons:
    //   config  - global state, not a project operation
    //   rm      - the stale-project cleanup, before a target is known
    //   --help  - asks the binary what it supports, not a project
    //   --flag  - `ldm --version`, not a subcommand at all
    // Quoted text is stripped first, or every `echo "... ldm system doctor"`
    // hint and the string ".ldm configuration" reads as a call.
    const allowed = new Set(['config', 'rm']);
    const offenders = [];

    source.split('\n').forEach((line, i) => {
      const code = line
        .replace(/#.*/, '')
        .replace(/"[^"]*"/g, '""')
        .replace(/'[^']*'/g, "''");

      if (/ldm_cmd|command ldm|bin\/ldm|ldm\(\)/.test(code)) return;
      if (/--help/.test(code)) return;

      // Command position only: start of line, or after ; & | ( or $(
      const match = code.match(/(?:^|[;&|(]|\$\()\s*ldm\s+(?!-)([a-z-]+)/);

      if (!match || allowed.has(match[1])) return;

      offenders.push(`${i + 1}: ${line.trim()}`);
    });

    expect(offenders).toEqual([]);
  });

  it('routes the concurrency check through the target', () => {
    // Asking this host what else is running answers about the wrong machine.
    const fn = source.slice(
      source.indexOf('other_running_ldm_projects() {'),
      source.indexOf('write_signal() {')
    );

    expect(fn).toContain('ldm_cmd list --json');
  });

  it('routes the credential lookup through the target', () => {
    expect(source).toContain(
      'ldm_cmd info "$PROJECT_NAME" --credentials --json'
    );
  });
});

describe('a captured LDM call cannot swallow a diagnostic', () => {
  it('keeps log_command off stdout', () => {
    const fn = source.slice(source.indexOf('log_command() {'));

    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('>&2');
  });

  it('survives a verbose run with the output captured', () => {
    // The real shape: VERBOSE=1 with $(...) around ldm_cmd. A [CMD] line on
    // stdout lands inside the JSON and the parse fails silently.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldmcalls-'));
    const lines = source.split('\n');
    const start = lines.findIndex((l) => l.startsWith('log_command() {'));
    const end = lines.findIndex((l, i) => i > start && l === '}');

    const script = [
      'VERBOSE=1',
      lines.slice(start, end + 1).join('\n'),
      'fake() { log_command "ldm info --json"; echo \'[{"type":"admin","email":"a@b.c"}]\'; }',
      'OUT=$(fake)',
      'node -e \'JSON.parse(process.argv[1]); console.log("parsed")\' "$OUT"',
    ].join('\n');

    const out = execFileSync('bash', ['-c', script], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    expect(out).toContain('parsed');
  });
});
