const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

/**
 * E2E Test Orchestrator
 * This script triggers the Playwright test suite and analyzes logs.
 */

const MICROSERVICE_DIR = path.join(
  __dirname,
  '../client-extensions/ai-commerce-accelerator-microservice'
);
const LOG_DIR = path.join(__dirname, '../logs');
const MS_LOG_FILE = path.join(LOG_DIR, 'e2e-microservice.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

// Clear old logs
if (fs.existsSync(MS_LOG_FILE)) {
  fs.unlinkSync(MS_LOG_FILE);
}

const logStream = fs.createWriteStream(MS_LOG_FILE, { flags: 'a' });

let msProcess = null;

async function startMicroservice() {
  console.log('>>> Starting Microservice in E2E mode...');

  msProcess = spawn('node', ['server.cjs'], {
    cwd: MICROSERVICE_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: 3001,
      PERSISTENCE_DB_PATH: ':memory:',
      NODE_TLS_REJECT_UNAUTHORIZED: '0', // Bypass SSL verification for local HTTPS
      LIFERAY_OAUTH_CLIENT_ID: '', // Force Basic Auth
      LIFERAY_OAUTH_CLIENT_SECRET: '',
      LIFERAY_AUTH_METHOD: 'basic',
      LIFERAY_URL: process.env.LIFERAY_URL,
    },
  });

  msProcess.stdout.pipe(logStream);
  msProcess.stderr.pipe(logStream);

  msProcess.on('error', (err) => {
    console.error('FAILED to start microservice:', err);
    process.exit(1);
  });

  return new Promise((resolve, reject) => {
    const checkHealth = () => {
      const req = http.get('http://localhost:3001/api/v1/health', (res) => {
        if (res.statusCode === 200) {
          console.log('>>> Microservice is HEALTHY.');
          resolve();
        } else {
          console.log(
            `>>> Microservice health probe returned ${res.statusCode}. Waiting...`
          );
          setTimeout(checkHealth, 1000);
        }
      });

      req.on('error', () => {
        setTimeout(checkHealth, 1000);
      });
    };

    checkHealth();

    // Timeout after 120 seconds
    setTimeout(() => {
      reject(new Error('Microservice failed to become healthy within 120s'));
    }, 120000);
  });
}

async function runPlaywright() {
  const PLAYWRIGHT_DIR = path.join(__dirname, '../playwright');
  const CONFIG_PATH = 'playwright-e2e.config.js';

  console.log('>>> Running Playwright Tests...');
  console.log(`>>> Working Directory: ${PLAYWRIGHT_DIR}`);
  console.log(`>>> Configuration: ${CONFIG_PATH}`);

  return new Promise((resolve) => {
    const pw = spawn('npx', ['playwright', 'test', `--config=${CONFIG_PATH}`], {
      cwd: PLAYWRIGHT_DIR,
      stdio: 'inherit',
      shell: true,
    });

    pw.on('exit', (code) => {
      resolve(code);
    });
  });
}

function cleanup() {
  if (msProcess) {
    console.log('>>> Shutting down Microservice...');
    msProcess.kill();
  }
}

async function waitForLiferayObjects() {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const liferayUrl = process.env.LIFERAY_URL || 'http://localhost:8080';
  const username = process.env.LIFERAY_API_USERNAME || 'test@liferay.com';
  const password = process.env.LIFERAY_API_PASSWORD || 'test';
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  const checkUrl = `${liferayUrl}/o/c/aicaconfigurations`;
  console.log(
    `>>> Waiting for Liferay Custom Objects to be fully published at ${checkUrl}...`
  );

  const maxAttempts = 60; // 10 minutes (60 * 10s)
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch(checkUrl, {
        headers: { Authorization: authHeader },
      });
      if (res.ok) {
        console.log('>>> Liferay Custom Objects are READY.');
        return;
      }
      console.log(
        `>>> Object API not ready (${res.status}). Waiting 10s... (Attempt ${i}/${maxAttempts})`
      );
    } catch (e) {
      console.log(
        `>>> Connection error (${e.message}). Waiting 10s... (Attempt ${i}/${maxAttempts})`
      );
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error('Liferay Custom Objects failed to publish within timeout.');
}

async function main() {
  try {
    console.log('>>> [START] E2E Verification Orchestrator');
    await waitForLiferayObjects();
    await startMicroservice();
    console.log('>>> [STEP] Microservice started and healthy.');

    const exitCode = await runPlaywright();
    console.log(`>>> [STEP] Playwright suite finished with code ${exitCode}`);

    if (fs.existsSync(MS_LOG_FILE)) {
      console.log('>>> Running Forensic Log Analysis...');
      const analyze = spawn(
        'node',
        ['scripts/analyze-e2e-logs.js', MS_LOG_FILE],
        {
          cwd: path.join(__dirname, '..'),
          stdio: 'inherit',
        }
      );

      analyze.on('exit', (analyzeCode) => {
        if (analyzeCode !== 0) {
          console.log('FAIL: Forensic log analysis detected critical errors.');
          process.exit(1);
        } else {
          console.log('SUCCESS: No unexpected errors detected in logs.');
          if (exitCode !== 0) {
            console.log(`FAIL: Playwright suite exited with code ${exitCode}`);
            process.exit(exitCode);
          }
          process.exit(0);
        }
      });
    } else {
      if (exitCode !== 0) {
        console.log(`FAIL: Playwright suite exited with code ${exitCode}`);
        process.exit(exitCode);
      }
      process.exit(0);
    }
  } catch (err) {
    console.error('FATAL ERROR in Orchestrator:', err.message);
    process.exit(1);
  }
}

// Ensure cleanup on various exit signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

main();
