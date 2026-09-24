const { createSandbox } = require('./fixtures/rootScriptSandbox.cjs');

/**
 * `detect-secrets.mjs` is the last thing between a pasted credential and the
 * history of a public repository, and it runs in the pre-commit hook where
 * nobody reads its output when it passes. A pattern that quietly stopped
 * matching would look exactly like a clean tree, every time, which is the
 * failure #978 is about.
 *
 * None of the samples below appear as literals in this file. They are assembled
 * at run time so that the fixtures which prove the patterns work cannot
 * themselves trip the check, the repository's own scanners, or push protection.
 */

const SAMPLES = {
  aws: `AKIA${'ABCDEFGHIJKLMNOP'}`,
  openai: `sk-${'a'.repeat(40)}`,
  github: `ghp_${'b'.repeat(36)}`,
  google: `AIzaSy${'C'.repeat(35)}`,
  privateKey: `-----BEGIN RSA PRIVATE ${'KEY'}-----`,
};

describe('detect-secrets: a credential in a staged file (#978)', () => {
  const sandboxes = [];

  const check = (files, { staged = Object.keys(files) } = {}) => {
    const sandbox = createSandbox('detect-secrets.mjs', files);

    sandboxes.push(sandbox);

    sandbox.git('init', '-q');
    sandbox.git('add', '--', ...staged);

    return sandbox.run();
  };

  afterEach(() => {
    while (sandboxes.length) sandboxes.pop().dispose();
  });

  it('passes when nothing is staged', () => {
    const sandbox = createSandbox('detect-secrets.mjs', {});

    sandboxes.push(sandbox);
    sandbox.git('init', '-q');

    const result = sandbox.run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No staged files to check');
  });

  it('passes a staged file that carries no credential', () => {
    const result = check({
      'src/config.js': "export const endpoint = 'https://example.test';\n",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No leaked secrets detected');
  });

  it.each([
    ['AWS Access Key ID / Secret Access Key', SAMPLES.aws],
    ['OpenAI API Key', SAMPLES.openai],
    ['GitHub Personal Access Token', SAMPLES.github],
    ['Gemini / Google API Key', SAMPLES.google],
    ['Private SSH / SSL Key Header', SAMPLES.privateKey],
  ])('fails on a %s', (name, sample) => {
    const result = check({
      'src/config.js': `const credential = "${sample}";\n`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`[${name}]`);
    expect(result.stderr).toContain('src/config.js');
  });

  it('names the line the credential is on', () => {
    const result = check({
      'src/config.js': ['const a = 1;', '', `const b = "${SAMPLES.aws}";`].join(
        '\n'
      ),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/config.js on line 3');
  });

  it('counts every credential rather than stopping at the first', () => {
    const result = check({
      'src/config.js': [
        `const a = "${SAMPLES.aws}";`,
        `const b = "${SAMPLES.openai}";`,
      ].join('\n'),
      'src/other.js': `const c = "${SAMPLES.github}";\n`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Detected 3 potential secrets leak(s)');
  });

  it('honours the inline allowlist pragma', () => {
    const result = check({
      'src/config.js': `const mock = "${SAMPLES.aws}"; // pragma: allowlist secret\n`,
    });

    expect(result.status).toBe(0);
  });

  it('honours a literal token registered in .gitleaksignore', () => {
    const result = check({
      '.gitleaksignore': `# mock values\n${SAMPLES.aws}\n`,
      'src/config.js': `const mock = "${SAMPLES.aws}";\n`,
    });

    expect(result.status).toBe(0);
  });

  it('honours a path pattern registered in .gitleaksignore', () => {
    const result = check({
      '.gitleaksignore': 'src/**/*.fixture.js\n',
      'src/deep/sample.fixture.js': `const mock = "${SAMPLES.aws}";\n`,
    });

    expect(result.status).toBe(0);
  });

  it('does not treat a path pattern as a substring to match anywhere', () => {
    const result = check({
      '.gitleaksignore': 'src/**/*.fixture.js\n',
      'src/deep/sample.js': `const mock = "${SAMPLES.aws}";\n`,
    });

    expect(result.status).toBe(1);
  });

  it('reads only what is staged, not the working tree', () => {
    const result = check(
      {
        'src/config.js': "export const endpoint = 'https://example.test';\n",
        'src/unstaged.js': `const leaked = "${SAMPLES.aws}";\n`,
      },
      { staged: ['src/config.js'] }
    );

    expect(result.status).toBe(0);
  });

  /**
   * Documented, not endorsed: the script skips whole directories and commented
   * lines. Anything that moves those rules should have to change a test that
   * says what the hole is, rather than widen it unnoticed.
   */
  it.each([
    ['tests/sample.js'],
    ['src/mocks/sample.js'],
    ['scripts/scratchpad.js'],
    ['yarn.lock'],
  ])('does not look inside %s', (file) => {
    const result = check({ [file]: `const mock = "${SAMPLES.aws}";\n` });

    expect(result.status).toBe(0);
  });

  it('does not look at a commented line', () => {
    const result = check({
      'src/config.js': `// const old = "${SAMPLES.aws}";\n`,
    });

    expect(result.status).toBe(0);
  });
});
