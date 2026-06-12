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
const LIFERAY_URL = process.env.LIFERAY_PORTAL_URL || 'https://aica-e2e.local';
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

async function handleGenerate(opts) {
  console.log(`Initializing Data Generation...`);
  const payload = {
    ...buildConnectionPayload(),
    demoMode: opts.demoMode || false,
    productCount: opts.productCount || 2,
    accountCount: opts.accountCount || 2,
    orderCount: opts.orderCount || 5,
    createWarehouses: true,
    reuseExistingWarehouses: true,
    generatePriceLists: true,
    generateSkuVariants: true,
    generateSpecifications: true,
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

  const payload = buildConnectionPayload();
  const res = await nativePost(
    `${MICROSERVICE_URL}/api/v1/${endpoint}`,
    payload
  );
  if (!res.success || !res.sessionId) {
    throw new Error(res.error || 'Failed to submit deletion workflow.');
  }

  console.log(`\n🛑 Deletion Workflow Started! Session ID: ${res.sessionId}`);
  await pollProgress(res.sessionId);
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

Options:
  --demo                                 Use Mock Data instead of Gemini AI
  --products N                           Specify product target volume
  --accounts N                           Specify business accounts volume
  --orders N                             Specify order target volume
  --all                                  Perform global deletions
  --selected                             Perform selected channel deletions

Convention Rules:
  - Scans current directory cascading up for standard local '.env' parameters.
  - Defaults to local microservice running at port 3001.
`);
}
