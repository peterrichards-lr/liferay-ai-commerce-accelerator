import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Color constants for pretty CLI reporting
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

let hasCriticalFailure = false;

// Custom zero-dependency .env parser to run before node_modules are ready
function loadEnv() {
  const envPath = path.resolve(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    console.warn(
      `${YELLOW}⚠️ Warning: No .env file found in workspace root. Using process environment variables.${RESET}\n`
    );
    return process.env;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const env = { ...process.env };
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index === -1) return;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"'))
      value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'"))
      value = value.slice(1, -1);
    env[key] = value;
  });
  return env;
}

// Check if a port is already bound
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true); // Port is in use
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false); // Port is free
    });
    server.listen(port);
  });
}

// Test HTTP connection to Liferay URL
function checkLiferay(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    try {
      const parsedUrl = new URL(url);
      const requester = parsedUrl.protocol === 'https:' ? https : http;
      const req = requester.get(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          timeout: 3000,
        },
        (res) => {
          // Any response (even redirect or auth 401) proves server is reachable
          resolve(true);
        }
      );
      req.on('error', () => {
        resolve(false);
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

async function runPreflight() {
  console.log(
    `${BOLD}🛡️  Liferay AI Commerce Accelerator Sentinel — Pre-flight Checks${RESET}\n`
  );

  const env = loadEnv();

  // 1. Validate Essential Env Variables
  console.log('📋 Validating required environment variables...');
  const liferayUrl =
    env.LIFERAY_API_URL || env.LIFERAY_URL || 'http://localhost:8080';
  const liferayUsername = env.LIFERAY_API_USERNAME || env.LIFERAY_API_USER;
  const liferayPassword = env.LIFERAY_API_PASSWORD;

  if (!liferayUsername || !liferayPassword) {
    console.error(
      `❌ [${RED}ERROR${RESET}] Missing Liferay connection credentials in .env.`
    );
    console.error(
      `          Ensure both ${BOLD}LIFERAY_API_USERNAME${RESET} and ${BOLD}LIFERAY_API_PASSWORD${RESET} are set.`
    );
    hasCriticalFailure = true;
  } else {
    console.log(`   ✅ Credentials registered (${liferayUsername})`);
  }

  // Check for AI API keys (Warn only)
  const aiKeys = [
    env.OPENAI_API_KEY,
    env.GEMINI_API_KEY,
    env.ANTHROPIC_API_KEY,
    env.AI_API_KEY,
  ];
  const hasAIKey = aiKeys.some((key) => key && key.trim() !== '');
  if (!hasAIKey) {
    console.warn(
      `   ${YELLOW}⚠️ Warning: No AI provider keys found in .env (OpenAI, Gemini, Anthropic).`
    );
    console.warn(
      `              AI features will fall back to disconnected mock states.${RESET}`
    );
  } else {
    console.log('   ✅ AI API keys detected');
  }

  console.log();

  // 2. Validate Port Availability
  console.log('🔌 Checking required local ports...');
  const ports = [
    { num: 3001, name: 'Microservice Backend' },
    { num: 5173, name: 'Frontend React Server' },
  ];

  for (const port of ports) {
    const isBound = await checkPort(port.num);
    if (isBound) {
      console.error(
        `❌ [${RED}ERROR${RESET}] Port ${BOLD}${port.num}${RESET} (${port.name}) is already in use.`
      );
      console.error(
        `          Please kill the stale process running on port ${port.num} before starting.`
      );
      hasCriticalFailure = true;
    } else {
      console.log(`   ✅ Port ${port.num} is available (${port.name})`);
    }
  }

  console.log();

  // 3. Validate Live Liferay instance connectivity (Warn only to support offline dev/mock modes)
  console.log(
    `🌐 Verifying Liferay DXP connectivity to ${BOLD}${liferayUrl}${RESET}...`
  );
  const isLiferayOnline = await checkLiferay(liferayUrl);
  if (!isLiferayOnline) {
    console.warn(
      `   ${YELLOW}⚠️ Warning: Cannot connect to Liferay at ${liferayUrl}`
    );
    console.warn(
      `              Please ensure Liferay is started and running, or verify your network routing.`
    );
    console.warn(
      `              E2E tests and live API requests will fail if offline.${RESET}`
    );
  } else {
    console.log(`   ✅ Liferay connection succeeded!`);
  }

  console.log('\n----------------------------------------');

  if (hasCriticalFailure) {
    console.error(
      `\n❌ ${RED}${BOLD}Pre-flight verification failed!${RESET} Aborting startup.`
    );
    console.error(
      `   Please address the errors listed above before launching the stack.\n`
    );
    process.exit(1);
  } else {
    console.log(
      `\n✅ ${GREEN}${BOLD}Pre-flight verification succeeded!${RESET} Starting development environment...\n`
    );
    process.exit(0);
  }
}

runPreflight();
