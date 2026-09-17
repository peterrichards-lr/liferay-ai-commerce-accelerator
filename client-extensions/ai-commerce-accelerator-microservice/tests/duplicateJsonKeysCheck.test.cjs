const { createSandbox } = require('./fixtures/rootScriptSandbox.cjs');

/**
 * `JSON.parse` keeps the last of two identical keys and reports nothing, so a
 * manifest can carry a `dependencies` block that no tool ever reads and look
 * well-formed to every one of them. `check-duplicate-json-keys` scans the raw
 * text instead, which is the only way to see it - and being a hand-written
 * character scanner rather than a parser, it is exactly the kind of check that
 * can stop matching and still print its tick (#978).
 *
 * The cases below are the two halves of that: the duplicates it must catch, and
 * the string contents that must not be mistaken for keys.
 */

const MANIFESTS = {
  root: 'package.json',
  microservice:
    'client-extensions/ai-commerce-accelerator-microservice/package.json',
  configuration:
    'client-extensions/ai-commerce-accelerator-configuration/package.json',
  frontend: 'client-extensions/ai-commerce-accelerator-frontend/package.json',
};

const CLEAN = '{\n  "name": "clean",\n  "version": "0.0.1"\n}\n';

describe('check-duplicate-json-keys: a key JSON.parse would silently drop (#978)', () => {
  const sandboxes = [];

  const check = (files) => {
    const sandbox = createSandbox('check-duplicate-json-keys.cjs', {
      [MANIFESTS.microservice]: CLEAN,
      [MANIFESTS.configuration]: CLEAN,
      [MANIFESTS.frontend]: CLEAN,
      ...files,
    });

    sandboxes.push(sandbox);

    return sandbox.run();
  };

  afterEach(() => {
    while (sandboxes.length) sandboxes.pop().dispose();
  });

  it('passes on manifests with no repeated key', () => {
    const result = check({ [MANIFESTS.root]: CLEAN });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('validation passed');
  });

  it('fails on a key repeated at the top level', () => {
    const result = check({
      [MANIFESTS.root]: [
        '{',
        '  "name": "root",',
        '  "dependencies": { "vitest": "5.0.0" },',
        '  "dependencies": { "vitest": "4.1.11" }',
        '}',
      ].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Duplicate JSON key "dependencies"');
    expect(result.stderr).toContain(MANIFESTS.root);
  });

  it('fails on a key repeated inside a nested object', () => {
    const result = check({
      [MANIFESTS.root]: [
        '{',
        '  "scripts": {',
        '    "test": "vitest run",',
        '    "lint": "eslint .",',
        '    "test": "echo nothing"',
        '  }',
        '}',
      ].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Duplicate JSON key "test"');
  });

  it('checks the workspace manifests and not only the root one', () => {
    const result = check({
      [MANIFESTS.root]: CLEAN,
      [MANIFESTS.frontend]: [
        '{',
        '  "version": "0.0.1",',
        '  "version": "0.0.2"',
        '}',
      ].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(MANIFESTS.frontend);
  });

  it('does not confuse the same key in two different objects', () => {
    const result = check({
      [MANIFESTS.root]: [
        '{',
        '  "name": "root",',
        '  "dependencies": { "name": "a" },',
        '  "devDependencies": { "name": "b" }',
        '}',
      ].join('\n'),
    });

    expect(result.status).toBe(0);
  });

  it('does not read a colon inside a string value as a key separator', () => {
    const result = check({
      [MANIFESTS.root]: [
        '{',
        '  "scripts": {',
        '    "serve": "node -e \\"a\\": b",',
        '    "start": "http://localhost:3000"',
        '  },',
        '  "name": "root"',
        '}',
      ].join('\n'),
    });

    expect(result.status).toBe(0);
  });

  it('reads the key through an escape sequence', () => {
    const result = check({
      [MANIFESTS.root]: ['{', '  "a\\"b": 1,', '  "a\\"b": 2', '}'].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Duplicate JSON key');
  });

  it('skips a manifest that is not present rather than failing', () => {
    const sandbox = createSandbox('check-duplicate-json-keys.cjs', {
      [MANIFESTS.root]: CLEAN,
    });

    sandboxes.push(sandbox);

    const result = sandbox.run();

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(MANIFESTS.frontend);
  });
});
