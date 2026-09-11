#!/usr/bin/env node

/**
 * Liferay AI Commerce Accelerator (AICA) - Zero-Dependency Headless CLI Client
 * Hides Node.js execution details, leveraging Configuration-by-Convention for ultra-fast seeding!
 */

const fs = require('fs');
const path = require('path');

// --- 1. Dynamic .env / Convention Discovery ---
function loadEnv() {
  const searchPaths = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '../..'),
  ];

  for (const dir of searchPaths) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return;
          const index = trimmed.indexOf('=');
          if (index === -1) return;
          const key = trimmed.slice(0, index).trim();
          let value = trimmed.slice(index + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = value;
          }
        });
        break;
      } catch (e) {
        // Fallback silently if unreadable
      }
    }
  }
}

loadEnv();

// --- 2. Environment Configurations & Defaults ---
const MICROSERVICE_URL =
  process.env.AICA_MICROSERVICE_URL || 'http://localhost:3001';
const LIFERAY_URL =
  process.env.LIFERAY_PORTAL_URL ||
  process.env.LIFERAY_URL ||
  process.env.LIFERAY_API_URL ||
  'https://aica-e2e.demo';
const LIFERAY_USERNAME = process.env.LIFERAY_API_USERNAME || 'test@liferay.com';
const LIFERAY_PASSWORD = process.env.LIFERAY_API_PASSWORD || 'test';

// --- 3. Argument Parsing & Schema Setup ---
const args = process.argv.slice(2);
const command = args[0];

if (
  !command ||
  [
    'connect',
    'generate',
    'delete',
    'export',
    'extract',
    'import',
    'config',
    'reindex',
    '--help',
    '-h',
  ].includes(command) === false
) {
  printHelp();
  process.exit(1);
}

if (command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

// Extract optional parameters
const options = {};
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--demo') options.demoMode = true;
  if (arg === '--all') options.all = true;
  if (arg === '--selected') options.selected = true;
  if (arg === '-y' || arg === '--yes' || arg === '--non-interactive') {
    options.nonInteractive = true;
  }
  if (arg === '--products' && args[i + 1]) {
    options.productCount = parseInt(args[i + 1], 10);
    i++;
  }
  if (arg === '--accounts' && args[i + 1]) {
    options.accountCount = parseInt(args[i + 1], 10);
    i++;
  }
  if (arg === '--orders' && args[i + 1]) {
    options.orderCount = parseInt(args[i + 1], 10);
    i++;
  }
  if (arg === '--bulk-pricing') options.generateBulkPricing = true;
  if (arg === '--no-bulk-pricing') options.generateBulkPricing = false;
  if (arg === '--tier-pricing') options.generateTierPricing = true;
  if (arg === '--no-tier-pricing') options.generateTierPricing = false;
  if (arg === '--specifications') options.generateSpecifications = true;
  if (arg === '--no-specifications') options.generateSpecifications = false;
  if (arg === '--warehouses') options.createWarehouses = true;
  if (arg === '--no-warehouses') options.createWarehouses = false;
  if (arg === '--warehouse-count' && args[i + 1]) {
    options.warehouseCount = parseInt(args[i + 1], 10);
    i++;
  }
  if ((arg === '--image-mode' || arg === '--images') && args[i + 1]) {
    options.imageMode = args[i + 1];
    i++;
  }
  if ((arg === '--pdf-mode' || arg === '--pdfs') && args[i + 1]) {
    options.pdfMode = args[i + 1];
    i++;
  }
  if ((arg === '--channel-id' || arg === '--channel') && args[i + 1]) {
    options.channelId = parseInt(args[i + 1], 10);
    i++;
  }
  if ((arg === '--site-group-id' || arg === '--site-group') && args[i + 1]) {
    options.siteGroupId = parseInt(args[i + 1], 10);
    i++;
  }
  if ((arg === '--catalog-id' || arg === '--catalog') && args[i + 1]) {
    options.catalogId = parseInt(args[i + 1], 10);
    i++;
  }
  if (arg === '--docker') options.docker = true;
  if (arg === '--api') options.api = true;
  if (arg === '--bundle' || arg === '--with-media') options.bundle = true;
  if (arg === '--instance') options.instance = true;
}

// --- 4. Main Command Routing Router ---
(async () => {
  try {
    switch (command) {
      case 'connect':
        await handleConnect();
        break;
      case 'generate':
        await handleGenerate(options);
        break;
      case 'delete':
        await handleDelete(options);
        break;
      case 'export':
        await handleExport(args[1], args[2], options);
        break;
      case 'extract':
        await handleExtract(args[1], args[2], options);
        break;
      case 'import':
        await handleImport(args[1]);
        break;
      case 'config':
        await handleConfig(args[1], args[2], args.slice(2));
        break;
      case 'reindex':
        await handleReindex(args[1], options);
        break;
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
})();

// --- 5. Command Handlers & Implementation ---

async function handleConnect() {
  console.log(`Connecting to AICA Microservice at: ${MICROSERVICE_URL}...`);
  const payload = buildConnectionPayload();

  const res = await nativePost(
    `${MICROSERVICE_URL}/api/v1/test-connection`,
    payload
  );
  if (res.success) {
    console.log(
      `\n🟢 Handshake Successful! Connected to Liferay at: ${LIFERAY_URL}`
    );
    console.log(`OAuth2 Session Established.`);
  } else {
    throw new Error(res.error || 'Handshake failed.');
  }
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

async function askQuestion(query) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function resolveCommerceContext(opts) {
  let channelId =
    opts.channelId ||
    toNumber(process.env.AICA_CHANNEL_ID || process.env.LIFERAY_CHANNEL_ID);
  let siteGroupId =
    opts.siteGroupId ||
    toNumber(
      process.env.AICA_SITE_GROUP_ID || process.env.LIFERAY_SITE_GROUP_ID
    );
  let catalogId =
    opts.catalogId ||
    toNumber(process.env.AICA_CATALOG_ID || process.env.LIFERAY_CATALOG_ID);

  const isNonInteractive =
    opts.nonInteractive || !process.stdout.isTTY || !process.stdin.isTTY;

  if (
    channelId !== undefined &&
    siteGroupId !== undefined &&
    catalogId !== undefined
  ) {
    return { channelId, siteGroupId, catalogId };
  }

  console.log(
    'Resolving commerce context (channels and catalogs) from Liferay...'
  );

  let channels = [];
  let catalogs = [];
  try {
    const creds = buildConnectionPayload();

    // Retry channel resolution up to 15 times (30 seconds) to allow Liferay to finish creating default sites during boot
    let attempt = 0;
    while (attempt < 15) {
      const channelsRes = await nativePost(
        `${MICROSERVICE_URL}/api/v1/get-channels`,
        creds
      );
      if (
        channelsRes &&
        channelsRes.success &&
        Array.isArray(channelsRes.channels) &&
        channelsRes.channels.length > 0
      ) {
        channels = channelsRes.channels;
        break;
      }
      attempt++;
      if (attempt < 15)
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const catalogsRes = await nativePost(
      `${MICROSERVICE_URL}/api/v1/get-catalogs`,
      creds
    );
    if (
      catalogsRes &&
      catalogsRes.success &&
      Array.isArray(catalogsRes.catalogs)
    ) {
      catalogs = catalogsRes.catalogs;
    }
  } catch (err) {
    console.warn(
      `⚠️ Warning: Failed to fetch active commerce context from microservice: ${err.message}`
    );
  }

  // A. Resolve channelId and siteGroupId
  if (channelId === undefined) {
    if (channels.length > 0) {
      if (channels.length === 1 || isNonInteractive) {
        channelId = parseInt(channels[0].id, 10);
        if (siteGroupId === undefined) {
          siteGroupId = parseInt(channels[0].siteGroupId, 10);
        }
        console.log(
          `Auto-selected Channel: ${channels[0].name} (ID: ${channelId})`
        );
      } else {
        console.log('\nAvailable Channels:');
        channels.forEach((c, index) => {
          console.log(
            `  ${index + 1}) ${c.name} (ID: ${c.id}, Site Group: ${c.siteGroupId})`
          );
        });
        const ans = await askQuestion(
          `Select a Channel (1-${channels.length}) or enter custom ID [1]: `
        );
        const selIdx = parseInt(ans, 10) - 1;
        if (!isNaN(selIdx) && selIdx >= 0 && selIdx < channels.length) {
          channelId = parseInt(channels[selIdx].id, 10);
          if (siteGroupId === undefined) {
            siteGroupId = parseInt(channels[selIdx].siteGroupId, 10);
          }
        } else if (ans !== '') {
          channelId = parseInt(ans, 10);
        } else {
          channelId = parseInt(channels[0].id, 10);
          if (siteGroupId === undefined) {
            siteGroupId = parseInt(channels[0].siteGroupId, 10);
          }
        }
      }
    }
  } else if (siteGroupId === undefined) {
    // If channelId was explicitly provided, try to find its matching siteGroupId
    const matchingChannel = channels.find(
      (c) => Number(c.id) === Number(channelId)
    );
    if (matchingChannel) {
      siteGroupId = parseInt(matchingChannel.siteGroupId, 10);
    }
  }

  // B. Resolve catalogId
  if (catalogId === undefined) {
    if (catalogs.length > 0) {
      if (catalogs.length === 1 || isNonInteractive) {
        catalogId = parseInt(catalogs[0].id, 10);
        console.log(
          `Auto-selected Catalog: ${catalogs[0].name} (ID: ${catalogId})`
        );
      } else {
        console.log('\nAvailable Catalogs:');
        catalogs.forEach((c, index) => {
          console.log(`  ${index + 1}) ${c.name} (ID: ${c.id})`);
        });
        const ans = await askQuestion(
          `Select a Catalog (1-${catalogs.length}) or enter custom ID [1]: `
        );
        const selIdx = parseInt(ans, 10) - 1;
        if (!isNaN(selIdx) && selIdx >= 0 && selIdx < catalogs.length) {
          catalogId = parseInt(catalogs[selIdx].id, 10);
        } else if (ans !== '') {
          catalogId = parseInt(ans, 10);
        } else {
          catalogId = parseInt(catalogs[0].id, 10);
        }
      }
    }
  }

  // C. Fallback interactive prompt if still missing and interactive
  if (!isNonInteractive) {
    if (channelId === undefined || isNaN(channelId)) {
      const ans = await askQuestion('Enter Channel ID: ');
      channelId = parseInt(ans, 10);
    }
    if (siteGroupId === undefined || isNaN(siteGroupId)) {
      const ans = await askQuestion('Enter Site Group ID: ');
      siteGroupId = parseInt(ans, 10);
    }
    if (catalogId === undefined || isNaN(catalogId)) {
      const ans = await askQuestion('Enter Catalog ID: ');
      catalogId = parseInt(ans, 10);
    }
  }

  // D. Delegate to backend if still missing
  if (
    channelId === undefined ||
    isNaN(channelId) ||
    siteGroupId === undefined ||
    isNaN(siteGroupId) ||
    catalogId === undefined ||
    isNaN(catalogId)
  ) {
    console.warn(
      '\n⚠️ Warning: Missing some commerce context settings locally. Delegating resolution to the backend.'
    );
  }

  return { channelId, siteGroupId, catalogId };
}

async function handleGenerate(opts) {
  console.log(`Initializing Data Generation...`);
  const ctx = await resolveCommerceContext(opts);

  const payload = {
    ...buildConnectionPayload(),
    demoMode: opts.demoMode || false,
    productCount: opts.productCount || 2,
    accountCount: opts.accountCount || 2,
    orderCount: opts.orderCount || 5,
    imageMode: opts.imageMode || 'default',
    pdfMode: opts.pdfMode || 'default',
    createWarehouses: opts.createWarehouses !== false,
    warehouseCount: opts.warehouseCount || 1,
    generatePriceLists: true,
    generateSkuVariants: true,
    generateSpecifications: opts.generateSpecifications !== false,
    generateBulkPricing: opts.generateBulkPricing !== false,
    generateTierPricing: opts.generateTierPricing !== false,
    channelId: ctx.channelId,
    siteGroupId: ctx.siteGroupId,
    catalogId: ctx.catalogId,
  };

  const res = await nativePost(
    `${MICROSERVICE_URL}/api/v1/generate/workflow`,
    payload
  );
  if (!res.success || !res.sessionId) {
    throw new Error(res.error || 'Failed to submit generation workflow.');
  }

  console.log(`\n🚀 Generation Workflow Started! Session ID: ${res.sessionId}`);
  await pollProgress(res.sessionId);
}

async function handleDelete(opts) {
  const isSelected = opts.selected && !opts.all;
  const endpoint = isSelected
    ? 'delete-selected-commerce-data'
    : 'delete-commerce-data';
  console.log(
    `Initializing ${isSelected ? 'Selected' : 'All'} Commerce Data Deletion...`
  );

  const payload = {
    ...buildConnectionPayload(),
  };

  if (isSelected) {
    const ctx = await resolveCommerceContext(opts);
    payload.channelId = ctx.channelId;
    payload.siteGroupId = ctx.siteGroupId;
    payload.catalogId = ctx.catalogId;
  }

  const res = await nativePost(
    `${MICROSERVICE_URL}/api/v1/${endpoint}`,
    payload
  );
  const sessionId = res.sessionId || res.summary?.sessionId;
  if (!res.success || !sessionId) {
    throw new Error(res.error || 'Failed to submit deletion workflow.');
  }

  console.log(`\n🛑 Deletion Workflow Started! Session ID: ${sessionId}`);
  await pollProgress(sessionId);
}

/**
 * What a package reports about itself, printed rather than swallowed.
 *
 * The counts are the result of an export or an extract, not decoration: a
 * package that carries fewer pictures than its source still downloads, still
 * imports, and still looks like success. Anything above zero is said out loud
 * and the command exits non-zero on a required-field shortfall, so a script
 * that promotes a catalogue can stop rather than promote a thin one.
 */
function reportPackageCounts(headers) {
  const count = (name) => {
    const value = headers.get(name);
    return value === null ? null : Number(value);
  };

  const images = count('X-AICA-Media-Images');
  const pdfs = count('X-AICA-Media-Pdfs');
  const unresolved = count('X-AICA-Media-Unresolved');
  const incomplete = count('X-AICA-Products-Incomplete');
  const partial = count('X-AICA-Products-Partial');
  const source = headers.get('X-AICA-Media-Source');

  console.log(
    `   Media: ${images ?? 0} image(s), ${pdfs ?? 0} attachment(s)${source ? ` (from the ${source})` : ''}`
  );

  if (partial) {
    console.log(
      `   ${partial} product(s) are missing optional fields only - usually blank on the source`
    );
  }

  if (unresolved) {
    console.warn(
      `\n⚠️  ${unresolved} media item(s) could not be included. The package carries fewer pictures than its source.`
    );
  }

  if (incomplete) {
    console.warn(
      `\n⚠️  ${incomplete} product(s) are missing a field the schema requires; see metadata.translationReport inside the package.`
    );
  }

  return { images, incomplete, partial, pdfs, unresolved };
}

function packagePath(outputPath, fallbackName) {
  return outputPath
    ? path.resolve(process.cwd(), outputPath)
    : path.resolve(process.cwd(), `${fallbackName}.aicap`);
}

async function handleExport(sessionId, outputPath, opts = {}) {
  if (!sessionId) {
    throw new Error(
      'Please specify a sessionId to export (aica export <sessionId> [outputPath] [--bundle])'
    );
  }

  if (opts.bundle) {
    const resolvedPath = packagePath(outputPath, `aica-package-${sessionId}`);

    console.log(
      `Building a dataset package for ${sessionId} at: ${resolvedPath}...`
    );

    // The cheap half of the pair: this reads the media this service already
    // wrote to disk, so it calls no Liferay and needs no credentials.
    const { buffer, headers } = await nativeDownload(
      `${MICROSERVICE_URL}/api/v1/export-commerce-bundle?sessionId=${encodeURIComponent(sessionId)}`
    );

    fs.writeFileSync(resolvedPath, buffer);
    console.log(`\n🟢 Package written to disk! (${buffer.length} bytes)`);
    reportPackageCounts(headers);
    return;
  }

  const defaultPath = path.resolve(
    process.cwd(),
    `aica-dataset-${sessionId}.json`
  );
  const resolvedPath = outputPath
    ? path.resolve(process.cwd(), outputPath)
    : defaultPath;

  console.log(`Exporting session dataset ${sessionId} to: ${resolvedPath}...`);

  const res = await nativeGet(
    `${MICROSERVICE_URL}/api/v1/export-commerce-data?sessionId=${sessionId}`
  );
  if (!res || !res.products) {
    throw new Error(`Failed to retrieve dataset for session: ${sessionId}`);
  }

  fs.writeFileSync(resolvedPath, JSON.stringify(res, null, 2), 'utf8');
  console.log(
    `\n🟢 Dataset successfully written to disk! (${res.products.length} Products, ${res.accounts.length} Accounts, ${res.orders.length} Orders)`
  );
  console.log(
    `   No media: this is the dataset alone. Use --bundle for a package carrying its images and attachments.`
  );
}

/**
 * Pull a package out of a live Liferay.
 *
 * The expensive half: it authenticates against an instance and fetches every
 * binary across the network, where `export --bundle` reads a directory. Worth
 * it when the media was never written locally - a dataset generated before the
 * archive existed, or a catalogue this service did not build.
 *
 * The source is stated rather than inferred. `--instance` reads the whole
 * catalogue; a session id reads that run and fills in its archive on the way
 * through, so a later export of it is cheap.
 */
async function handleExtract(sessionId, outputPath, opts = {}) {
  const fromInstance = Boolean(opts.instance);

  if (!fromInstance && !sessionId) {
    throw new Error(
      'Please specify what to extract: aica extract <sessionId> [outputPath], or aica extract --instance [outputPath]'
    );
  }

  const target = fromInstance ? 'instance' : sessionId;
  const resolvedPath = packagePath(
    fromInstance ? sessionId : outputPath,
    `aica-extract-${target}`
  );

  console.log(
    fromInstance
      ? `Extracting a package from ${LIFERAY_URL} to: ${resolvedPath}...`
      : `Extracting media for ${sessionId} from ${LIFERAY_URL} to: ${resolvedPath}...`
  );
  console.log(
    '   This reads the instance over the network, one request per attachment.'
  );

  const { buffer, headers } = await nativeDownload(
    `${MICROSERVICE_URL}/api/v1/extract-commerce-bundle`,
    {
      method: 'POST',
      payload: {
        ...buildConnectionPayload(),
        source: fromInstance ? 'instance' : 'session',
        ...(fromInstance ? {} : { sessionId }),
      },
    }
  );

  fs.writeFileSync(resolvedPath, buffer);
  console.log(`\n🟢 Package written to disk! (${buffer.length} bytes)`);

  const counts = reportPackageCounts(headers);

  if (counts.incomplete) {
    // A promotion built from this package would land products that cannot be
    // sold. A script should stop here rather than carry on to the import.
    process.exitCode = 1;
  }
}

async function handleImport(inputPath) {
  if (!inputPath) {
    throw new Error(
      'Please specify a dataset (.json) or package (.aicap) to import (aica import <inputPath>)'
    );
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Dataset file not found at: ${resolvedPath}`);
  }

  const bytes = fs.readFileSync(resolvedPath);
  // The same check the route makes, on the local file header rather than the
  // name, so a renamed package is still recognised - and so the two cannot
  // disagree about what is being sent.
  const isPackage =
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);

  if (!isPackage) {
    // Fails here rather than at the far end, where a malformed dataset is a
    // 400 with a parse error and no mention of the file it came from.
    try {
      JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      throw new Error(
        `${resolvedPath} is neither a dataset package nor valid JSON: ${error.message}`
      );
    }
  }

  console.log(
    `Uploading ${isPackage ? 'package' : 'dataset'} (${bytes.length} bytes) to ${LIFERAY_URL}...`
  );

  if (isPackage) {
    console.log('   Media travels with it and is attached as part of the run.');
  }

  // Multipart rather than a JSON body: a package is a zip, and the route
  // detects one by its header. Sending it as a field would make every
  // promotion a dataset with no pictures.
  const res = await nativeUpload(
    `${MICROSERVICE_URL}/api/v1/import-commerce-data`,
    buildConnectionPayload(),
    { bytes, field: 'importFile', filename: path.basename(resolvedPath) }
  );

  if (!res.success || !res.sessionId) {
    throw new Error(res.error || 'Failed to submit dataset import workflow.');
  }

  console.log(`\n🚀 Import Scaffolding Started! Session ID: ${res.sessionId}`);
  await pollProgress(res.sessionId);
}

async function handleConfig(subCommand, arg1, extraArgs) {
  if (!subCommand || !['get', 'set'].includes(subCommand)) {
    throw new Error(
      'Usage: aica config <get | set> [filePath | --key <name> --value <val>]'
    );
  }

  const credentials = buildConnectionPayload();

  if (subCommand === 'get') {
    console.log(
      'Retrieving active configuration parameters from microservice...'
    );

    // 1. Fetch AI config & batch sizes in parallel
    const [aiConfig, batchSizes] = await Promise.all([
      nativePost(`${MICROSERVICE_URL}/api/v1/config/ai`, credentials),
      nativePost(`${MICROSERVICE_URL}/api/v1/config/batch-sizes`, credentials),
    ]);

    const result = {
      config: aiConfig.config || {},
      generationConfig: aiConfig.generationConfig || {},
      batchSizes: batchSizes.batchSizes || {},
    };

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subCommand === 'set') {
    if (!arg1) {
      throw new Error(
        'Please specify a configuration JSON file path, or --key <name> --value <val>'
      );
    }

    let savePayload;

    // A. Single Key Setter Flow: --key <name> --value <val>
    if (arg1 === '--key') {
      const keyIndex = extraArgs.indexOf('--key');
      const valIndex = extraArgs.indexOf('--value');
      const keyName = extraArgs[keyIndex + 1];
      const valString = extraArgs[valIndex + 1];

      if (!keyName || !valString) {
        throw new Error('Usage: aica config set --key <name> --value <val>');
      }

      console.log(`Updating single property "${keyName}"...`);

      // Retrieve current config first
      const current = await nativePost(
        `${MICROSERVICE_URL}/api/v1/config/ai`,
        credentials
      );
      const config = current.config || {};
      const genConfig = current.generationConfig || {};

      // Parse primitive types dynamically
      let typedVal = valString;
      if (valString === 'true') typedVal = true;
      else if (valString === 'false') typedVal = false;
      else if (/^\d+$/.test(valString)) typedVal = parseInt(valString, 10);

      // Determine where the key belongs (standard mapping)
      const configKeys = [
        'liferayUrl',
        'clientId',
        'clientSecret',
        'localeCode',
        'languageId',
        'currencyCode',
        'selectedLanguages',
        'aiModel',
        'batchSize',
        'pollingDelay',
        'pollingRetries',
        'demoMode',
      ];
      if (configKeys.includes(keyName)) {
        config[keyName] = typedVal;
      } else {
        genConfig[keyName] = typedVal;
      }

      savePayload = {
        ...credentials,
        config,
        generationConfig: genConfig,
      };
    }
    // B. Bulk Import/JSON File Setter Flow
    else {
      const filePath = path.resolve(process.cwd(), arg1);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Configuration file not found at: ${filePath}`);
      }

      console.log(`Reading configuration from: ${filePath}...`);
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // Rehydrate required nested structure dynamically
      savePayload = {
        ...credentials,
        config: parsed.config || parsed,
        generationConfig: parsed.generationConfig || parsed,
      };
    }

    // Save configuration parameters to microservice
    const saveRes = await nativePost(
      `${MICROSERVICE_URL}/api/v1/config/save`,
      savePayload
    );
    if (!saveRes.success) {
      throw new Error(
        saveRes.error || 'Failed to save configuration parameters.'
      );
    }

    console.log(
      '\n🟢 Configuration updated successfully! Connection maintained.'
    );
  }
}

// --- 6. Helper APIs, Poller, and REST utilities ---

function buildConnectionPayload() {
  const payload = {
    liferayUrl: LIFERAY_URL,
    localeCode: 'en-US',
    languageId: 'en_US',
    currencyCode: 'USD',
  };

  if (process.env.LIFERAY_API_CLIENT_ID) {
    payload.clientId = process.env.LIFERAY_API_CLIENT_ID;
  }
  if (process.env.LIFERAY_API_CLIENT_SECRET) {
    payload.clientSecret = process.env.LIFERAY_API_CLIENT_SECRET;
  }

  return payload;
}

async function pollProgress(sessionId) {
  const isTTY = process.stdout.isTTY;
  let finished = false;

  while (!finished) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const res = await nativeGet(
        `${MICROSERVICE_URL}/api/v1/workflows/sessions/${sessionId}/status`
      );
      if (!res || !res.session) {
        throw new Error('Failed to fetch status updates.');
      }

      const session = res.session;
      const progress = session.overall_progress || 0;
      const step = session.active_step_key || 'polling';
      const status = session.status;

      // Format clean progress indicator text
      const progressDetails = `(${step} - Products: ${session.completed_products_count || 0}/${session.target_products_count || 0})`;

      if (isTTY) {
        // Draw real-time moving ASCII progress bar
        const width = 20;
        const filledLength = Math.round((width * progress) / 100);
        const emptyLength = width - filledLength;
        const bar = '█'.repeat(filledLength) + '░'.repeat(emptyLength);
        process.stdout.write(`\r⏳ [${bar}] ${progress}% ${progressDetails}`);
      } else {
        // Single line log print fallback for non-TTY (like Playwright/CI logs)
        console.log(`⏳ Progress: ${progress}% ${progressDetails}`);
      }

      if (status === 'COMPLETED' || progress >= 100) {
        finished = true;
        console.log(
          `\n\n🎉 Success! Session successfully completed with 100% progress!`
        );
      } else if (status === 'FAILED') {
        finished = true;
        throw new Error(
          session.terminal_error || 'Generation session failed on the backend.'
        );
      }
    } catch (e) {
      console.log(`\n❌ Polling encountered error: ${e.message}`);
      throw e;
    }
  }
}

async function nativePost(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * A response that is a file, with the headers that describe it.
 *
 * `nativeGet` and `nativePost` parse JSON, which turns a package into a string
 * of replacement characters. The headers matter as much as the bytes here: for
 * an export or an extract they carry what the package does and does not
 * contain.
 */
async function nativeDownload(url, { method = 'GET', payload } = {}) {
  const res = await fetch(url, {
    method,
    ...(payload
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text;

    try {
      message = JSON.parse(text).error || text;
    } catch {
      // Not JSON. The body, whatever it is, beats the status code alone.
    }

    throw new Error(`HTTP ${res.status}: ${message}`);
  }

  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    headers: res.headers,
  };
}

/** A multipart upload, built from the runtime's own FormData - no dependency. */
async function nativeUpload(url, fields, { bytes, field, filename }) {
  const form = new FormData();

  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    form.append(
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value)
    );
  });

  form.append(field, new Blob([bytes]), filename);

  const res = await fetch(url, { method: 'POST', body: form });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

async function nativeGet(url) {
  const res = await fetch(url, {
    method: 'GET',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function handleReindex(className, opts) {
  if (opts.docker) {
    await runDockerReindex(className);
    return;
  }

  // Built so the path appears literally rather than assembled from a fragment:
  // tests/surfaceParity.test.cjs reads these sources to find an endpoint no
  // surface can reach, and a path spelled `/api/v1/${endpoint}` is invisible
  // to it - which would have read as "the CLI cannot reindex" when it can.
  const endpoint = className
    ? `/api/v1/reindex/${className}`
    : '/api/v1/reindex';
  console.log(`Triggering search reindexing for: ${className || 'All'}`);

  const payload = {
    ...buildConnectionPayload(),
  };

  try {
    const res = await nativePost(`${MICROSERVICE_URL}${endpoint}`, payload);

    if (!res.success) {
      throw new Error(res.error || 'Failed to trigger reindexing.');
    }

    console.log(
      `\n✅ Reindexing trigger successful! Response: ${res.message || 'Scheduled'}`
    );
  } catch (error) {
    if (!opts.api) {
      console.warn(
        `⚠️ Microservice connection failed (${error.message}). Attempting local Docker fallback...`
      );
      await runDockerReindex(className);
    } else {
      throw error;
    }
  }
}

async function runDockerReindex(className) {
  console.log(
    `\n🐳 Executing Option 2: Local Docker Reindex for ${className || 'All'}...`
  );
  const { execSync } = require('child_process');
  try {
    execSync('docker ps', { stdio: 'ignore' });
  } catch (e) {
    throw new Error(
      'Docker is not running or accessible in this environment. Cannot run Docker reindex.'
    );
  }

  try {
    const liferayContainer = execSync(
      'docker ps --filter "name=liferay" --format "{{.Names}}"'
    )
      .toString()
      .trim()
      .split('\n')[0];
    if (!liferayContainer) {
      throw new Error('No active Liferay container found.');
    }

    console.log(`Found active Liferay container: ${liferayContainer}`);
    console.log('Invoking Liferay Docker Manager (LDM) reindex controller...');
    execSync('ldm reindex -y', { stdio: 'inherit' });
    console.log(
      '\n✅ Triggered reindex in LDM (immediate if container is running, otherwise scheduled for next startup).'
    );
  } catch (error) {
    throw new Error(`Docker reindex execution failed: ${error.message}`);
  }
}

function printHelp() {
  console.log(`
========================================================================
 Liferay AI Commerce Accelerator (AICA) - Headless Command Line Interface
========================================================================

Usage: aica <command> [options]

Commands:
  connect                                Handshake with target DXP server
  generate [--demo] [--products N]       Trigger a new data generation
  delete [--all | --selected]            Tear down and delete generated data
  export <sessionId> [outputPath]        Export a completed dataset as JSON, without media
  export <sessionId> --bundle [path]     Export it as a package (.aicap) carrying its media
  extract <sessionId> [outputPath]       Read a run's media back from the live instance
  extract --instance [outputPath]        Read the whole catalogue from the live instance
  import <inputPath>                     Import a dataset (.json) or package (.aicap)
  config get                             Retrieve active parameters from microservice
  config set <filePath>                  Import parameters from a JSON configuration file
  config set --key <name> --value <val>  Update a single configuration key dynamically
  reindex [className]                    Trigger search reindexing (defaults to all)

Options:
  --bundle / --with-media                Export a package (.aicap) rather than a JSON dataset
  --instance                             Extract the whole catalogue rather than one run
  --docker                               Force Option 2: local Docker/LDM reindex trigger
  --api                                  Force Option 1: REST API reindex trigger via microservice
  --demo                                 Use Mock Data instead of Gemini AI
  --products N                           Specify product target volume
  --accounts N                           Specify business accounts volume
  --orders N                             Specify order target volume
  --images <mode> / --image-mode <mode>  Specify image generation mode (none|default|picsum|ai) [default]
  --pdfs <mode> / --pdf-mode <mode>      Specify PDF generation mode (none|default|ai) [default]
  --[no-]bulk-pricing                    Enable/disable bulk pricing generation [true]
  --[no-]tier-pricing                    Enable/disable tier pricing generation [true]
  --[no-]specifications                  Enable/disable specification generation [true]
  --[no-]warehouses                      Enable/disable warehouse creation [true]
  --warehouse-count N                    Specify how many warehouses to create [1]
  --channel-id ID / --channel ID         Specify channel ID
  --site-group-id ID / --site-group ID   Specify site group ID
  --catalog-id ID / --catalog ID         Specify catalog ID
  -y / --yes / --non-interactive         Bypass interactive prompts and exit on missing config
  --all                                  Perform global deletions
  --selected                             Perform selected channel deletions

Moving a dataset between instances:
  - 'export --bundle' reads the media this service already wrote to disk. It
    calls no Liferay and needs no credentials, so it is the cheap route.
  - 'extract' reads a live instance instead, one request per attachment. Use it
    when the media was never held locally, and note that extracting a session
    fills in its archive, so a later export of it is cheap.
  - Both print what the package contains. A non-zero shortfall means it carries
    less than its source, and 'extract' exits non-zero when products are
    missing a field the schema requires.

Convention Rules:
  - Scans current directory cascading up for standard local '.env' parameters.
  - Defaults to local microservice running at port 3001.
`);
}
