#!/usr/bin/env node

/**
 * Liferay AI Commerce Accelerator (AICA) - Live AI Verification Utility
 * Performs an automated Playwright test specifically targeting Live AI generation flows
 * using your actual OpenAI, Gemini, or Anthropic API credentials.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Terminal Styling
const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const RED = `${ESC}[31m`;
const BLUE = `${ESC}[34m`;
const CYAN = `${ESC}[36m`;

console.log(
  `\n${BOLD}${CYAN}========================================================================${RESET}`
);
console.log(
  `${BOLD}${CYAN}   Liferay AI Commerce Accelerator - Live AI Verification Runner${RESET}`
);
console.log(
  `${BOLD}${CYAN}========================================================================${RESET}\n`
);

// 1. Load local environment variables from root .env
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');
const envVars = { ...process.env };

if (fs.existsSync(envPath)) {
  console.log(`📄 Loading environment variables from ${BOLD}.env${RESET}...`);
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
      if (!envVars[key]) {
        envVars[key] = value;
      }
    });
  } catch (err) {
    console.warn(
      `${YELLOW}⚠️ Warning: Could not read .env: ${err.message}${RESET}`
    );
  }
}

// 2. Resolve Active Target URL & Environment
const targetUrl =
  envVars.BASE_URL || envVars.LIFERAY_PORTAL_URL || 'https://aica-e2e.local';
console.log(`🌐 Target DXP URL: ${BOLD}${targetUrl}${RESET}`);

// 3. Resolve AI Keys and Providers
let chosenProvider = null;
let activeKey = null;

const getProviderFromKey = (key) => {
  if (!key || key === 'mock-sandbox' || String(key).trim().length === 0)
    return null;
  const k = String(key).trim();
  if (k.startsWith('sk-proj-') || k.startsWith('sk-')) {
    if (k.startsWith('sk-ant-')) return 'anthropic';
    return 'openai';
  }
  if (k.startsWith('AIzaSy')) return 'gemini';
  return null;
};

if (envVars.GEMINI_API_KEY && envVars.GEMINI_API_KEY !== 'mock-sandbox') {
  chosenProvider = 'gemini';
  activeKey = envVars.GEMINI_API_KEY;
} else if (
  envVars.OPENAI_API_KEY &&
  envVars.OPENAI_API_KEY !== 'mock-sandbox'
) {
  chosenProvider = 'openai';
  activeKey = envVars.OPENAI_API_KEY;
} else if (
  envVars.ANTHROPIC_API_KEY &&
  envVars.ANTHROPIC_API_KEY !== 'mock-sandbox'
) {
  chosenProvider = 'anthropic';
  activeKey = envVars.ANTHROPIC_API_KEY;
} else if (envVars.AI_API_KEY && envVars.AI_API_KEY !== 'mock-sandbox') {
  activeKey = envVars.AI_API_KEY;
  chosenProvider = getProviderFromKey(activeKey) || 'openai';
}

if (!chosenProvider || !activeKey) {
  console.error(`\n${RED}❌ Error: No live AI API keys detected.${RESET}`);
  console.error(
    `Please set at least one of the following variables in your shell or ${BOLD}.env${RESET}:`
  );
  console.error(`   - ${BOLD}GEMINI_API_KEY${RESET}`);
  console.error(`   - ${BOLD}OPENAI_API_KEY${RESET}`);
  console.error(`   - ${BOLD}ANTHROPIC_API_KEY${RESET}\n`);
  process.exit(1);
}

console.log(
  `🔑 Detected active provider: ${BOLD}${GREEN}${chosenProvider.toUpperCase()}${RESET}`
);
console.log(
  `🔑 API Key: ${BOLD}${activeKey.slice(0, 4)}...${activeKey.slice(-4)}${RESET}`
);

// 4. Resolve Microservice Execution & Lifecycle
let msProcess = null;

function cleanup() {
  if (msProcess) {
    console.log(`\n🛑 Shutting down microservice process...`);
    msProcess.kill();
    msProcess = null;
  }
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

async function checkHealth() {
  try {
    const res = await fetch('http://localhost:3001/api/v1/health', {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function startMicroservice() {
  console.log(`🚀 Spawning microservice in the background on port 3001...`);
  const microserviceDir = path.join(
    rootDir,
    'client-extensions/ai-commerce-accelerator-microservice'
  );

  const logDir = path.join(rootDir, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  const logFile = path.join(logDir, 'verify-live-ai-microservice.log');
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const runEnv = {
    ...envVars,
    NODE_ENV: 'test',
    PORT: 3001,
    PERSISTENCE_DB_PATH: ':memory:',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    LIFERAY_OAUTH_CLIENT_ID: '',
    LIFERAY_OAUTH_CLIENT_SECRET: '',
    LIFERAY_AUTH_METHOD: 'basic',
    LIFERAY_URL: targetUrl,
    LIFERAY_API_URL: targetUrl,
    LIFERAY_BATCH_CALLBACK_URL:
      'http://host.docker.internal:3001/api/v1/batch/callback',
    GEMINI_API_KEY:
      chosenProvider === 'gemini' ? activeKey : envVars.GEMINI_API_KEY,
    OPENAI_API_KEY:
      chosenProvider === 'openai' ? activeKey : envVars.OPENAI_API_KEY,
    ANTHROPIC_API_KEY:
      chosenProvider === 'anthropic' ? activeKey : envVars.ANTHROPIC_API_KEY,
  };

  msProcess = spawn('node', ['server.cjs'], {
    cwd: microserviceDir,
    env: runEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  msProcess.stdout.pipe(logStream);
  msProcess.stderr.pipe(logStream);

  msProcess.on('error', (err) => {
    console.error(
      `${RED}❌ Failed to start microservice: ${err.message}${RESET}`
    );
    process.exit(1);
  });

  // Poll health endpoint
  const maxAttempts = 30;
  for (let i = 1; i <= maxAttempts; i++) {
    const online = await checkHealth();
    if (online) {
      console.log(`${GREEN}🟢 Microservice is ONLINE and healthy!${RESET}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Microservice failed to become healthy within 30 seconds.');
}

console.log(`\n🔍 Checking if AICA microservice is online...`);
const isAlreadyOnline = await checkHealth();

if (isAlreadyOnline) {
  console.log(
    `${GREEN}🟢 Microservice is already running on port 3001.${RESET}`
  );
} else {
  await startMicroservice();
}

// 5. Trigger E2E Live AI Playwright Run
console.log(
  `\n🚀 Starting Playwright E2E verification test for ${BOLD}Live (AI) Mode${RESET}...`
);
console.log(
  `⏳ Running Live Mode test using ${BOLD}${chosenProvider.toUpperCase()}${RESET}. Please wait...`
);

const args = [
  'playwright',
  'test',
  'tests/e2e/dashboard.spec.js',
  '--config=playwright-e2e.config.js',
  '--grep',
  'Live \\(AI\\) Mode',
];

const runEnv = {
  ...envVars,
  GEMINI_API_KEY:
    chosenProvider === 'gemini' ? activeKey : envVars.GEMINI_API_KEY,
  OPENAI_API_KEY:
    chosenProvider === 'openai' ? activeKey : envVars.OPENAI_API_KEY,
  ANTHROPIC_API_KEY:
    chosenProvider === 'anthropic' ? activeKey : envVars.ANTHROPIC_API_KEY,
  BASE_URL: targetUrl,
  LIFERAY_URL: targetUrl,
  LIFERAY_API_URL: targetUrl,
  LIFERAY_PORTAL_URL: targetUrl,
  LIFERAY_BATCH_CALLBACK_URL:
    'http://host.docker.internal:3001/api/v1/batch/callback',
};

const child = spawn('npx', args, {
  cwd: path.join(rootDir, 'playwright'),
  env: runEnv,
  stdio: 'inherit',
  shell: false,
});

child.on('close', (code) => {
  cleanup();
  if (code === 0) {
    console.log(
      `\n${BOLD}${GREEN}========================================================================${RESET}`
    );
    console.log(
      `${BOLD}${GREEN}🎉 SUCCESS: Live AI generation verification completed successfully!${RESET}`
    );
    console.log(
      `${BOLD}${GREEN}========================================================================${RESET}\n`
    );
    process.exit(0);
  } else {
    console.log(
      `\n${BOLD}${RED}========================================================================${RESET}`
    );
    console.log(
      `${BOLD}${RED}❌ FAILURE: Live AI verification failed (Exit Code: ${code})${RESET}`
    );
    console.log(
      `${BOLD}${RED}========================================================================${RESET}`
    );
    console.log(`💡 Troubleshooting tips:`);
    console.log(
      `   1. Verify your API credentials key in .env is active and has sufficient quota.`
    );
    console.log(
      `   2. Run ${BOLD}yarn ldm:monitor${RESET} in another terminal to check microservice log tracebacks.`
    );
    console.log(
      `   3. Check Playwright snapshots in the ${BOLD}test-results/${RESET} folder for browser error screenshots.\n`
    );
    process.exit(code);
  }
});
