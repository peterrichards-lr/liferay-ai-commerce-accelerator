const fs = require('node:fs');
const path = require('node:path');

const {
  withoutHashComments,
  withoutSlashComments,
} = require('./fixtures/sourceComments.cjs');

/**
 * The stripper the source-scanning guards depend on (#1172).
 *
 * Every case here asserts both directions. A stripper that returned `''`
 * would satisfy every `not.toMatch` in the suite and nothing would fail, so
 * "the comment is gone" is never asserted without "the code is still there"
 * beside it - which is the mistake this whole issue is about, one level down.
 */
describe('withoutHashComments', () => {
  it('removes a whole-line comment and keeps the code around it', () => {
    const stripped = withoutHashComments(
      [
        '# head of the file',
        'ls -la "$d"',
        '  # cat the thing',
        'echo done',
      ].join('\n')
    );

    expect(stripped).not.toMatch(/\b(cat|head)\b/);
    expect(stripped).toContain('ls -la "$d"');
    expect(stripped).toContain('echo done');
  });

  it('removes a trailing comment and keeps the command it follows', () => {
    // The #1171 version filtered whole lines only, so a comment written
    // beside the code it explains still matched.
    const stripped = withoutHashComments('sed -n 1,40p "$f"  # not head');

    expect(stripped).not.toMatch(/\bhead\b/);
    expect(stripped).toContain('sed -n 1,40p "$f"');
  });

  it('keeps a # that is part of the code', () => {
    const stripped = withoutHashComments(
      [
        'echo "${NAME#prefix}"',
        'echo "$# args"',
        "grep '#define' file",
        'echo "a # inside double quotes"',
      ].join('\n')
    );

    expect(stripped).toContain('${NAME#prefix}');
    expect(stripped).toContain('$# args');
    expect(stripped).toContain("'#define'");
    expect(stripped).toContain('a # inside double quotes');
  });

  it('keeps the line count, so ordering guards still line up', () => {
    const source = ['# one', 'two', '# three', 'four'].join('\n');
    const stripped = withoutHashComments(source);

    expect(stripped.split('\n')).toHaveLength(4);
    expect(stripped.split('\n')[1]).toBe('two');
    expect(stripped.split('\n')[3]).toBe('four');
  });

  it('leaves a file with no comments untouched', () => {
    const source = 'set -euo pipefail\nmain "$@"\n';

    expect(withoutHashComments(source)).toBe(source);
  });

  it('does not empty the script it is used on', () => {
    // The blunt end of the same worry: if this ever returned nothing, every
    // `not.toMatch` guard in the suite would pass vacuously.
    const script = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '..', 'scripts', 'run-e2e-ldm.sh'),
      'utf8'
    );
    const stripped = withoutHashComments(script);

    expect(stripped.length).toBeGreaterThan(script.length * 0.4);
    expect(stripped).toContain('ldm_cmd() {');
    expect(stripped).toContain('trap cleanup EXIT');
  });
});

describe('withoutSlashComments', () => {
  it('removes line and block comments and keeps the code', () => {
    const stripped = withoutSlashComments(
      [
        '// ENV.LEGACY_SETTING is no longer read',
        'const a = ENV.REAL_SETTING;',
        '/* ENV.ALSO_GONE',
        '   over two lines */',
        'const b = 2; // ENV.TRAILING',
      ].join('\n')
    );

    expect(stripped).not.toMatch(/LEGACY_SETTING|ALSO_GONE|TRAILING/);
    expect(stripped).toContain('const a = ENV.REAL_SETTING;');
    expect(stripped).toContain('const b = 2;');
  });

  it('keeps a // inside a string or a template literal', () => {
    const stripped = withoutSlashComments(
      [
        "const url = 'https://example.invalid/path';",
        'const t = `${base}//double`;',
        'const d = "/* not a comment */";',
      ].join('\n')
    );

    expect(stripped).toContain("'https://example.invalid/path'");
    expect(stripped).toContain('`${base}//double`');
    expect(stripped).toContain('"/* not a comment */"');
  });

  it('keeps the line count across a block comment', () => {
    const stripped = withoutSlashComments(
      ['const a = 1;', '/* two', '   three */', 'const b = 4;'].join('\n')
    );

    expect(stripped.split('\n')).toHaveLength(4);
    expect(stripped.split('\n')[0]).toBe('const a = 1;');
    expect(stripped.split('\n')[3]).toBe('const b = 4;');
  });

  it('leaves a file with no comments untouched', () => {
    const source = "const x = require('node:fs');\nmodule.exports = { x };\n";

    expect(withoutSlashComments(source)).toBe(source);
  });

  it('does not empty the source it is used on', () => {
    const constants = fs.readFileSync(
      path.resolve(__dirname, '..', 'utils', 'constants.cjs'),
      'utf8'
    );
    const stripped = withoutSlashComments(constants);

    expect(stripped.length).toBeGreaterThan(constants.length * 0.5);
    expect(stripped).toContain('module.exports');
  });
});
