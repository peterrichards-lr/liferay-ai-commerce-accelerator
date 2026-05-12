/**
 * Liferay Client Generator
 *
 * Automatically generates a fluent JavaScript client from OpenAPI schemas.
 * Supports Namespaced Versioning to allow multiple API versions concurrently.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_DIR = path.join(__dirname, '../api-schemas');
const OUTPUT_FILE = path.join(
  __dirname,
  '../src/liferay/GeneratedLiferayClient.cjs'
);

function toCamelCase(str) {
  // Strip trailing version like -v1.0 or -v2.0
  const clean = str.replace(/-v\d+\.\d+$/, '');
  return clean.replace(/[-.]([a-z0-9])/g, (g) => g[1].toUpperCase());
}

function toNamespaceVersion(v) {
  // Ensure we don't end up with 'vv1_0'
  const clean = v.replace(/^v/, '');
  return 'v' + clean.replace(/\./g, '_');
}

function generate() {
  console.log('--- Generating Namespaced Liferay Client ---');

  if (!fs.existsSync(SCHEMA_DIR)) {
    console.error('✗ No schemas found. Run "yarn sync" first.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('-openapi.json'));
  let methodImplementations = [];
  let namespaceInitStrings = [];
  let totalMethods = 0;

  for (const file of files) {
    const spec = JSON.parse(
      fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8')
    );
    const apiName = file.replace('-openapi.json', '');
    const apiVersion = spec.info?.version || '1.0';

    const namespace = toCamelCase(apiName);
    const versionKey = toNamespaceVersion(apiVersion);

    let apiRoot = spec.servers?.[0]?.url || '';

    console.log(`Processing ${apiName} (${apiVersion})...`);

    if (!spec.paths) {
      console.warn(`! Skipping ${apiName}: No paths found.`);
      continue;
    }

    // Clean up apiRoot (strip domain if present)
    const rootMatch = apiRoot.match(/(\/o\/.*)/);
    const cleanRoot = rootMatch ? rootMatch[1] : apiRoot;

    let apiMethods = [];

    for (const [pathUrl, methods] of Object.entries(spec.paths)) {
      for (const [httpMethod, op] of Object.entries(methods)) {
        if (!op.operationId) continue;

        const methodName = op.operationId;
        // Use a unique internal name to avoid any global namespace issues
        const internalName = `_${methodName}_${namespace}_${versionKey}`;

        // Construct clean full path
        const fullPath = `${cleanRoot}${pathUrl}`.replace(/\/+/g, '/');

        // Extract parameters
        const pathParams = (op.parameters || [])
          .filter((p) => p.in === 'path')
          .map((p) => p.name);

        const methodArgs = [...pathParams, 'data', 'opts = {}'].join(', ');

        let templatePath = fullPath;
        pathParams.forEach((p) => {
          templatePath = templatePath.replace(`{${p}}`, `\${${p}}`);
        });

        const methodImpl = `
  /**
   * ${op.summary || methodName}
   * API: ${apiName} | Version: ${apiVersion}
   */
  async ${internalName}(config, ${methodArgs}) {
    return await this.rest._request(config, {
      method: '${httpMethod.toUpperCase()}',
      url: \`${templatePath}\`,
      data,
      op: '${methodName}',
      friendly: 'Generated method ${methodName} failed',
      ...opts
    });
  }`;

        methodImplementations.push(methodImpl);
        apiMethods.push(
          `        ${methodName}: this.${internalName}.bind(this)`
        );
        totalMethods++;
      }
    }

    const namespaceInit = `
    // ${apiName} (${apiVersion})
    if (!this.${namespace}) this.${namespace} = {};
    this.${namespace}.${versionKey} = {
${apiMethods.join(',\n')}
    };`;

    namespaceInitStrings.push(namespaceInit);
  }

  const classTemplate = `
/**
 * GeneratedLiferayClient
 * DO NOT EDIT MANUALLY. USE "yarn generate".
 */

class GeneratedLiferayClient {
  constructor(restService) {
    this.rest = restService;
${namespaceInitStrings.join('\n')}
  }
${methodImplementations.join('\n')}
}

module.exports = GeneratedLiferayClient;
`;

  fs.writeFileSync(OUTPUT_FILE, classTemplate);
  console.log(
    `✓ Generated client with ${totalMethods} methods across ${files.length} APIs to ${OUTPUT_FILE}`
  );
}

generate();
