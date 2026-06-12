import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const VALID_CX_TYPES = [
  'jsImportMapsEntry',
  'oAuthApplicationHeadlessServer',
  'oAuthApplicationUserAgent',
  'themeCSS',
  'batchEngineData',
  'siteInitializer',
  'batch',
  'customElement',
];

let failed = false;

function logError(file, block, message) {
  console.error(
    `❌ [\x1b[31mError\x1b[0m] ${path.relative(ROOT_DIR, file)}${block ? ` -> Block: [${block}]` : ''}: ${message}`
  );
  failed = true;
}

function logWarning(file, block, message) {
  console.warn(
    `⚠️ [\x1b[33mWarning\x1b[0m] ${path.relative(ROOT_DIR, file)}${block ? ` -> Block: [${block}]` : ''}: ${message}`
  );
}

// Retrieve all project paths registered in LDM
function getLdmProjectDirs() {
  const ldmRegistryPath = path.join(os.homedir(), '.ldm', 'registry.json');
  if (fs.existsSync(ldmRegistryPath)) {
    try {
      const registry = JSON.parse(fs.readFileSync(ldmRegistryPath, 'utf8'));
      return Object.values(registry)
        .map((proj) => proj && proj.path)
        .filter(Boolean)
        .map((p) => path.resolve(p));
    } catch (err) {
      // Ignore parsing/reading errors
    }
  }
  return [];
}

const ldmDirs = getLdmProjectDirs();

function findYamlFiles(dir, fileList = []) {
  const resolvedDir = path.resolve(dir);
  if (ldmDirs.includes(resolvedDir)) {
    return fileList;
  }

  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (
      file === 'node_modules' ||
      file === 'build' ||
      file === 'dist' ||
      file === 'bundles'
    )
      continue;
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      if (
        fs.existsSync(path.join(filePath, '.liferay-docker.deployed')) ||
        fs.existsSync(path.join(filePath, 'docker-compose.yml'))
      ) {
        continue;
      }
      findYamlFiles(filePath, fileList);
    } else if (file === 'client-extension.yaml') {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function validateCXFile(filePath) {
  let fileContent;
  try {
    fileContent = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    logError(filePath, null, `Failed to read file: ${err.message}`);
    return;
  }

  let parsed;
  try {
    parsed = YAML.parse(fileContent);
  } catch (err) {
    logError(filePath, null, `YAML Parsing Error: ${err.message}`);
    return;
  }

  if (!parsed || typeof parsed !== 'object') {
    logError(filePath, null, 'File does not contain a valid YAML object');
    return;
  }

  // 1. Validate Assemble block
  if (parsed.assemble) {
    if (!Array.isArray(parsed.assemble)) {
      logError(
        filePath,
        'assemble',
        'The assemble property must be an array of objects'
      );
    } else {
      parsed.assemble.forEach((item, index) => {
        if (!item.from && !item.include) {
          logError(
            filePath,
            'assemble',
            `Item at index ${index} must contain either 'from' or 'include' properties`
          );
        }
        if (item.from && !item.into) {
          logError(
            filePath,
            'assemble',
            `Item at index ${index} with 'from' must also contain an 'into' property`
          );
        }
      });
    }
  }

  // 2. Validate Extension Blocks
  for (const [key, block] of Object.entries(parsed)) {
    if (key === 'assemble') continue;

    // Validate block key/ID format
    if (!/^[a-z0-9-]+$/.test(key)) {
      logError(
        filePath,
        key,
        `Block ID must be alphanumeric and hyphenated lowercase (e.g. my-client-extension)`
      );
    }

    if (!block || typeof block !== 'object') {
      logError(filePath, key, `Block definition must be a valid YAML map`);
      continue;
    }

    // Validate Required Properties
    if (!block.name) {
      logError(filePath, key, `Missing required property: 'name'`);
    } else if (typeof block.name !== 'string' || block.name.trim() === '') {
      logError(filePath, key, `Property 'name' must be a non-empty string`);
    }

    if (!block.type) {
      logError(filePath, key, `Missing required property: 'type'`);
    } else {
      if (!VALID_CX_TYPES.includes(block.type)) {
        logWarning(
          filePath,
          key,
          `Type '${block.type}' is unrecognized. Expected one of: [${VALID_CX_TYPES.join(', ')}]`
        );
      }

      // Type-Specific Validations
      if (block.type === 'jsImportMapsEntry') {
        if (!block.bareSpecifier) {
          logError(
            filePath,
            key,
            `jsImportMapsEntry missing required property: 'bareSpecifier'`
          );
        }
        if (!block.url) {
          logError(
            filePath,
            key,
            `jsImportMapsEntry missing required property: 'url'`
          );
        }
      }

      if (
        block.type === 'oAuthApplicationHeadlessServer' ||
        block.type === 'oAuthApplicationUserAgent'
      ) {
        if (!block.scopes) {
          logError(
            filePath,
            key,
            `${block.type} missing required property: 'scopes'`
          );
        } else if (!Array.isArray(block.scopes)) {
          logError(filePath, key, `Property 'scopes' must be an array`);
        } else {
          block.scopes.forEach((scope, index) => {
            if (typeof scope !== 'string' || scope.trim() === '') {
              logError(
                filePath,
                key,
                `Scope at index ${index} must be a non-empty string`
              );
            } else if (/\s/.test(scope)) {
              logError(
                filePath,
                key,
                `Scope '${scope}' contains invalid whitespace characters`
              );
            }
          });
        }

        if (
          block['.serviceAddress'] &&
          /localhost|127\.0\.0\.1/.test(block['.serviceAddress'])
        ) {
          logWarning(
            filePath,
            key,
            `Service address points to localhost (${block['.serviceAddress']}). Ensure this is dynamically configured or updated for production environments.`
          );
        }
      }
    }
  }
}

function run() {
  console.log('🔍 Locating Liferay Client Extension configuration files...');
  const files = findYamlFiles(ROOT_DIR);
  console.log(
    `Found ${files.length} client-extension.yaml files to validate.\n`
  );

  files.forEach(validateCXFile);

  if (failed) {
    console.error(
      '\n❌ \x1b[31mValidation Failed!\x1b[0m Please fix the errors listed above.'
    );
    process.exit(1);
  } else {
    console.log(
      '\n✅ \x1b[32mAll client-extension.yaml files are valid!\x1b[0m'
    );
    process.exit(0);
  }
}

run();
