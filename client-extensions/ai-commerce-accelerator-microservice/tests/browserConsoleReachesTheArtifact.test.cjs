const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

/**
 * The browser console must reach the artifact, from every spec (#1286).
 *
 * Run 38410417089 produced 371 lines of browser diagnostics and uploaded none
 * of them. Seventy were the only trace anywhere of the OAuth failure that cost
 * nine days, and I read their absence from `logs/e2e-liferay.log` as evidence
 * the cause was elsewhere. It was not elsewhere; the artifact simply could not
 * contain it.
 *
 * Two of these guards are structural and one is behavioural. The structural
 * ones cannot tell you the capture works - that is the lesson
 * imageBuildIsDiagnosable.test.cjs records - so the write path is executed
 * here against a real temporary directory rather than asserted about.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE = path.join(ROOT, 'playwright', 'fixtures', 'diagnostics.js');
const HELPER = path.join(ROOT, 'playwright', 'tests', 'e2e', 'test-helper.js');
const SPEC_DIR = path.join(ROOT, 'playwright', 'tests');

const fixture = () => fs.readFileSync(FIXTURE, 'utf8');

function specFiles() {
  return fs
    .readdirSync(SPEC_DIR)
    .flatMap((dir) => {
      const full = path.join(SPEC_DIR, dir);
      if (!fs.statSync(full).isDirectory()) return [];
      return fs
        .readdirSync(full)
        .filter((f) => f.endsWith('.spec.js'))
        .map((f) => path.join(full, f));
    })
    .sort();
}

/**
 * Runs the fixture's real `append` against a temporary cwd.
 *
 * Lifted by source rather than imported, because importing the module pulls in
 * @playwright/test and a browser fixture graph to test eight lines of file IO.
 */
function runAppend(lines, { readOnly = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-capture-'));
  const source = fixture();
  const start = source.indexOf('const LOG_PATH =');
  const end = source.indexOf('\n}\n', source.indexOf('function append('));

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const context = {
    fs,
    path,
    process: { cwd: () => dir },
    module: {},
  };
  vm.createContext(context);
  vm.runInContext(
    `${source.slice(start, end + 3)}\nmodule.exports = { append };`,
    context
  );

  if (readOnly) {
    fs.mkdirSync(path.join(dir, 'logs'));
    fs.chmodSync(path.join(dir, 'logs'), 0o500);
  }

  for (const line of lines) {
    context.module.exports.append(line);
  }

  const file = path.join(dir, 'logs', 'e2e-browser-console.log');
  const contents = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;

  if (readOnly) fs.chmodSync(path.join(dir, 'logs'), 0o700);
  fs.rmSync(dir, { recursive: true, force: true });

  return contents;
}

describe('the capture reaches the artifact (#1286)', () => {
  it('writes under logs/, which is what the workflow uploads', () => {
    // A figure recorded only to the step log expires with the run, which is
    // the whole of #1286.
    expect(fixture()).toMatch(
      /path\.join\(\s*process\.cwd\(\),\s*'logs',\s*'e2e-browser-console\.log'\s*\)/
    );
  });

  it('actually writes the lines it is given', () => {
    const out = runAppend(['=== a spec ===', 'first', 'second']);

    expect(out).toBe('=== a spec ===\nfirst\nsecond\n');
  });

  it('truncates a stale file rather than appending this run to the last', () => {
    // A previous run's capture left in place reads as this run's evidence.
    const out = runAppend(['one', 'two']);

    expect(out.startsWith('one')).toBe(true);
    expect(out.match(/one/g)).toHaveLength(1);
  });

  it('cannot fail the run when logs/ is unwritable', () => {
    // #1238: a diagnostic must not become a second way for the run to die.
    expect(() => runAppend(['anything'], { readOnly: true })).not.toThrow();
  });
});

describe('no spec can be silent by construction (#1286)', () => {
  it('attaches to every test, not to the ones that opt in', () => {
    // The listeners used to live in injectAndConnectApp, which three of five
    // suites call. The other two produced no console output at all, and an
    // absent diagnostic reads exactly like a clean one.
    expect(fixture()).toMatch(/\{\s*auto:\s*true\s*\}/);
  });

  it('is imported by every spec file', () => {
    const offenders = specFiles().filter((f) =>
      /import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'@playwright\/test'/.test(
        fs.readFileSync(f, 'utf8')
      )
    );

    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('finds spec files at all, so an empty sweep cannot pass', () => {
    // Without this the guard above passes vacuously the moment the glob
    // breaks - which is the same defect it exists to catch.
    expect(specFiles().length).toBeGreaterThanOrEqual(7);
  });

  it('leaves a header for a test that logged nothing', () => {
    // "quiet" and "did not run" must not be the same bytes.
    expect(fixture()).toMatch(/recorded === 0/);
    expect(fixture()).toMatch(/ran, logged nothing/);
  });

  it('no longer wires the listeners up in the helper', () => {
    expect(fs.readFileSync(HELPER, 'utf8')).not.toMatch(
      /page\.on\(\s*'console'/
    );
  });
});

describe('the capture is not tuned to a known failure (#1286)', () => {
  it('records every console level, including warnings', () => {
    // WARNING carried the OAuth failure. A filter set to today's known
    // failure is how the next one gets dropped.
    const source = fixture();
    const handler = source.slice(
      source.indexOf("page.on('console'"),
      source.indexOf("page.on('pageerror'")
    );

    expect(handler).toMatch(/msg\.type\(\)\.toUpperCase\(\)/);
    expect(handler).not.toMatch(/===\s*'error'|!==\s*'warning'|filter/i);
  });

  it('keeps stdout as well as the file', () => {
    // Interleaved with the test output is what makes one failure readable
    // while it is happening; the file is what survives the run.
    const source = fixture();
    const record = source.slice(
      source.indexOf('const record ='),
      source.indexOf("page.on('console'")
    );

    expect(record).toMatch(/console\.log\(line\)/);
    expect(record).toMatch(/append\(line\)/);
  });
});
