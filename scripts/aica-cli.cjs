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
  'https://aica-e2e.local';
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
  if (arg === '--reuse-warehouses') options.reuseExistingWarehouses = true;
  if (arg === '--no-reuse-warehouses') options.reuseExistingWarehouses = false;
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
        await handleExport(args[1], args[2]);
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

  // D. Exit early in non-interactive if still missing
  if (
    channelId === undefined ||
    isNaN(channelId) ||
    siteGroupId === undefined ||
    isNaN(siteGroupId) ||
    catalogId === undefined ||
    isNaN(catalogId)
  ) {
    console.error('\n❌ Error: Missing required commerce context settings.');
    console.error(
      'Please specify them via CLI flags or environment variables:'
    );
    if (channelId === undefined || isNaN(channelId)) {
      console.error(
        '  - Channel ID: --channel-id or AICA_CHANNEL_ID / LIFERAY_CHANNEL_ID'
      );
    }
    if (siteGroupId === undefined || isNaN(siteGroupId)) {
      console.error(
        '  - Site Group ID: --site-group-id or AICA_SITE_GROUP_ID / LIFERAY_SITE_GROUP_ID'
      );
    }
    if (catalogId === undefined || isNaN(catalogId)) {
      console.error(
        '  - Catalog ID: --catalog-id or AICA_CATALOG_ID / LIFERAY_CATALOG_ID'
      );
    }
    process.exit(1);
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
    reuseExistingWarehouses: opts.reuseExistingWarehouses !== false,
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

async function handleExport(sessionId, outputPath) {
  if (!sessionId) {
    throw new Error(
      'Please specify a sessionId to export (aica export <sessionId> [outputPath])'
    );
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
}

async function handleImport(inputPath) {
  if (!inputPath) {
    throw new Error(
      'Please specify a path to the JSON dataset file (aica import <inputPath>)'
    );
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Dataset file not found at: ${resolvedPath}`);
  }

  console.log(`Reading dataset from: ${resolvedPath}...`);
  const fileContent = fs.readFileSync(resolvedPath, 'utf8');
  const dataset = JSON.parse(fileContent);

  console.log(`Uploading dataset payload to target DXP...`);
  const payload = {
    ...buildConnectionPayload(),
    dataset,
  };

  const res = await nativePost(
    `${MICROSERVICE_URL}/api/v1/import-commerce-data`,
    payload
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

  const endpoint = className ? `reindex/${className}` : 'reindex';
  console.log(`Triggering search reindexing for: ${className || 'All'}`);

  const payload = {
    ...buildConnectionPayload(),
  };

  try {
    const res = await nativePost(
      `${MICROSERVICE_URL}/api/v1/${endpoint}`,
      payload
    );

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
  export <sessionId> [outputPath]        Export completed dataset to a JSON file
  import <inputPath>                     Import a saved dataset onto the target
  config get                             Retrieve active parameters from microservice
  config set <filePath>                  Import parameters from a JSON configuration file
  config set --key <name> --value <val>  Update a single configuration key dynamically
  reindex [className]                    Trigger search reindexing (defaults to all)

Options:
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
  --[no-]reuse-warehouses                Enable/disable reusing existing warehouses [true]
  --channel-id ID / --channel ID         Specify channel ID
  --site-group-id ID / --site-group ID   Specify site group ID
  --catalog-id ID / --catalog ID         Specify catalog ID
  -y / --yes / --non-interactive         Bypass interactive prompts and exit on missing config
  --all                                  Perform global deletions
  --selected                             Perform selected channel deletions

Convention Rules:
  - Scans current directory cascading up for standard local '.env' parameters.
  - Defaults to local microservice running at port 3001.
`);
}
