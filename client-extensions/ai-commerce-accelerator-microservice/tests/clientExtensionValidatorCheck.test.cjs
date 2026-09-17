const { createSandbox } = require('./fixtures/rootScriptSandbox.cjs');

/**
 * `validate-cx.js` is the only thing that reads a `client-extension.yaml`
 * before Liferay does. A malformed block is otherwise discovered as a
 * deployment that does not appear, with no error naming the file, so the check
 * silently matching nothing costs a debugging session per occurrence (#978).
 *
 * Two behaviours are worth as much as the rules themselves: the directories it
 * refuses to walk - a deployed Liferay bundle under the workspace holds
 * hundreds of client extensions that are not this repository's to validate -
 * and the difference between an error and a warning, since only one of them
 * decides the exit status.
 */

const VALID = [
  'assemble:',
  '  - from: build/static',
  '    into: static',
  '',
  'ai-commerce-accelerator-frontend:',
  '    name: AICA Frontend',
  '    type: customElement',
  '    htmlElementName: aica-frontend',
  '',
  'ai-commerce-accelerator-oauth:',
  '    name: AICA Headless Server',
  '    type: oAuthApplicationHeadlessServer',
  '    scopes:',
  '        - Liferay.Headless.Commerce.Admin.Catalog.everything',
  '',
].join('\n');

describe('validate-cx: client extension descriptors are well formed (#978)', () => {
  const sandboxes = [];

  const check = (files) => {
    const sandbox = createSandbox('validate-cx.js', files, {
      dependencies: ['yaml'],
    });

    sandboxes.push(sandbox);

    return sandbox.run();
  };

  afterEach(() => {
    while (sandboxes.length) sandboxes.pop().dispose();
  });

  it('passes a well formed descriptor', () => {
    const result = check({ 'extensions/client-extension.yaml': VALID });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Found 1 client-extension.yaml files');
    expect(result.stdout).toContain('are valid');
  });

  it('fails a block with no name', () => {
    const result = check({
      'extensions/client-extension.yaml': [
        'aica-frontend:',
        '    type: customElement',
        '',
      ].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing required property: 'name'");
  });

  it('fails a block with no type', () => {
    const result = check({
      'extensions/client-extension.yaml': [
        'aica-frontend:',
        '    name: AICA Frontend',
        '',
      ].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing required property: 'type'");
  });

  it('fails a block id that is not lowercase and hyphenated', () => {
    const result = check({
      'extensions/client-extension.yaml': [
        'AICA_Frontend:',
        '    name: AICA Frontend',
        '    type: customElement',
        '',
      ].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Block ID must be alphanumeric');
  });

  it('fails an OAuth application whose scopes are not a list', () => {
    const result = check({
      'extensions/client-extension.yaml': [
        'aica-oauth:',
        '    name: AICA Headless Server',
        '    type: oAuthApplicationHeadlessServer',
        '    scopes: Liferay.Headless.Commerce.Admin.Catalog.everything',
        '',
      ].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Property 'scopes' must be an array");
  });

  it('fails a scope that carries whitespace', () => {
    const result = check({
      'extensions/client-extension.yaml': [
        'aica-oauth:',
        '    name: AICA Headless Server',
        '    type: oAuthApplicationUserAgent',
        '    scopes:',
        '        - Liferay.Headless.Commerce.Admin.Catalog.everything Liferay.Headless.Admin.User.everything',
        '',
      ].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('contains invalid whitespace');
  });

  it('fails a jsImportMapsEntry with no bare specifier or url', () => {
    const result = check({
      'extensions/client-extension.yaml': [
        'aica-imports:',
        '    name: AICA Imports',
        '    type: jsImportMapsEntry',
        '',
      ].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "missing required property: 'bareSpecifier'"
    );
    expect(result.stderr).toContain("missing required property: 'url'");
  });

  it('fails an assemble entry that copies from somewhere to nowhere', () => {
    const result = check({
      'extensions/client-extension.yaml': [
        'assemble:',
        '  - from: build/static',
        '',
        'aica-frontend:',
        '    name: AICA Frontend',
        '    type: customElement',
        '',
      ].join('\n'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must also contain an 'into' property");
  });

  it('fails a descriptor that is not parseable YAML', () => {
    const result = check({
      'extensions/client-extension.yaml': 'aica-frontend: [unterminated\n',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('YAML Parsing Error');
  });

  it('warns without failing on a type it does not recognise', () => {
    const result = check({
      'extensions/client-extension.yaml': [
        'aica-something:',
        '    name: AICA Something',
        '    type: notAThingLiferayKnows',
        '',
      ].join('\n'),
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain('is unrecognized');
  });

  it('does not walk build output or dependency trees', () => {
    const broken = 'aica-frontend:\n    type: customElement\n';

    const result = check({
      'extensions/client-extension.yaml': VALID,
      'build/client-extension.yaml': broken,
      'dist/client-extension.yaml': broken,
      'bundles/client-extension.yaml': broken,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Found 1 client-extension.yaml files');
  });

  it('does not walk a deployed Liferay bundle inside the workspace', () => {
    const result = check({
      'extensions/client-extension.yaml': VALID,
      'aica-e2e/docker-compose.yml': 'services: {}\n',
      'aica-e2e/osgi/client-extension.yaml':
        'aica-frontend:\n    type: customElement\n',
      'deployed/.liferay-docker.deployed': '',
      'deployed/osgi/client-extension.yaml':
        'aica-frontend:\n    type: customElement\n',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Found 1 client-extension.yaml files');
  });
});
