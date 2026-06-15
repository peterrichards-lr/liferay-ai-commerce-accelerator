#!/usr/bin/env node

/**
 * Liferay AI Commerce Accelerator (AICA) - Interactive Launcher Script
 * Zero-dependency console interface designed for non-technical users.
 * Supports macOS, Windows, and Linux.
 */

const { spawn, exec } = require('child_process');
const readline = require('readline');
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ANSI Terminal Colors
const C_RESET = '\x1b[0m';
const C_BOLD = '\x1b[1m';
const C_CYAN = '\x1b[36m';
const C_GREEN = '\x1b[32m';
const C_YELLOW = '\x1b[33m';
const C_RED = '\x1b[31m';
const C_BLUE = '\x1b[34m';
const C_DIM = '\x1b[2m';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ROOT_DIR = path.resolve(__dirname, '..');
const CLI_PATH = path.join(ROOT_DIR, 'scripts', 'aica-cli.cjs');
const MICROSERVICE_SERVER = path.join(
  ROOT_DIR,
  'client-extensions',
  'ai-commerce-accelerator-microservice',
  'server.cjs'
);

// Ensure log directory exists
const LOG_DIR = path.join(ROOT_DIR, 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// OS Browser Opening Helper
function openBrowser(url) {
  const platform = os.platform();
  let cmd;
  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.log(
        `${C_YELLOW}⚠️  Could not open browser automatically. Please visit ${url} manually.${C_RESET}`
      );
    }
  });
}

// Port status helper
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const onError = () => {
      socket.destroy();
      resolve(false);
    };
    socket.setTimeout(1500);
    socket.once('error', onError);
    socket.once('timeout', onError);
    socket.connect(port, '127.0.0.1', () => {
      socket.end();
      resolve(true);
    });
  });
}

// Helper to execute CLI commands
function runCli(args, callback) {
  console.log(
    `\n${C_DIM}⚙️  Running: node scripts/aica-cli.cjs ${args.join(' ')}${C_RESET}\n`
  );

  const env = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' };
  const child = spawn('node', [CLI_PATH, ...args], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env,
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log(`\n${C_GREEN}✅ Operation completed successfully!${C_RESET}`);
    } else {
      console.log(
        `\n${C_RED}❌ Operation failed with exit code ${code}.${C_RESET}`
      );
    }
    if (callback) callback();
  });
}

// Option 1: Start Microservice and open browser
async function startControlPanel(callback) {
  const port = 3001;
  const isRunning = await checkPort(port);

  if (isRunning) {
    console.log(
      `\n${C_GREEN}🚀 Admin Microservice is already running on port ${port}!${C_RESET}`
    );
    console.log(`${C_CYAN}🔗 Opening browser...${C_RESET}`);
    openBrowser(`http://localhost:${port}`);
    if (callback) callback();
    return;
  }

  console.log(
    `\n${C_CYAN}🚀 Starting Liferay AI Commerce Accelerator Microservice...${C_RESET}`
  );
  console.log(
    `${C_DIM}📝 Logs are being redirected to logs/microservice-run.log${C_RESET}`
  );

  const logFile = path.join(LOG_DIR, 'microservice-run.log');
  const out = fs.openSync(logFile, 'a');
  const err = fs.openSync(logFile, 'a');

  const env = { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' };
  const server = spawn('node', [MICROSERVICE_SERVER], {
    cwd: path.dirname(MICROSERVICE_SERVER),
    detached: true,
    stdio: ['ignore', out, err],
    env,
  });

  server.unref();

  // Wait for server boot
  let attempts = 0;
  const maxAttempts = 15;
  const interval = setInterval(async () => {
    attempts++;
    const active = await checkPort(port);
    if (active) {
      clearInterval(interval);
      console.log(
        `\n${C_GREEN}✅ Server started successfully on port ${port}!${C_RESET}`
      );
      console.log(`${C_CYAN}🔗 Opening Control Panel UI...${C_RESET}`);
      openBrowser(`http://localhost:${port}`);
      if (callback) callback();
    } else if (attempts >= maxAttempts) {
      clearInterval(interval);
      console.log(
        `\n${C_YELLOW}⚠️  Server is taking longer than usual to boot. Please check logs at logs/microservice-run.log${C_RESET}`
      );
      openBrowser(`http://localhost:${port}`);
      if (callback) callback();
    }
  }, 1000);
}

function showHeader() {
  console.clear();
  console.log(
    `${C_BOLD}${C_CYAN}======================================================================${C_RESET}`
  );
  console.log(
    `${C_BOLD}${C_CYAN}         🌐  LIFERAY AI COMMERCE ACCELERATOR - CONTROL CENTER        ${C_RESET}`
  );
  console.log(
    `${C_BOLD}${C_CYAN}======================================================================${C_RESET}`
  );
  console.log(
    `${C_DIM}  Simplifying Liferay Commerce Demo Seeding & AI Generation${C_RESET}`
  );
  console.log(
    `${C_CYAN}----------------------------------------------------------------------${C_RESET}`
  );
}

function mainMenu() {
  showHeader();
  console.log(
    `  ${C_BOLD}${C_GREEN}[1] 🖥️  Start & Open Local Dashboard UI${C_RESET}`
  );
  console.log(
    `  ${C_BOLD}${C_GREEN}[2] 📦 Populate DXP with Mock (Demo) Data (Instant/Offline)${C_RESET}`
  );
  console.log(
    `  ${C_BOLD}${C_GREEN}[3] ✨ Populate DXP with Live AI Data (Gemini/OpenAI)${C_RESET}`
  );
  console.log(
    `  ${C_BOLD}${C_YELLOW}[4] 🗑️  Clean / Teardown All Generated Data${C_RESET}`
  );
  console.log(
    `  ${C_BOLD}${C_BLUE}[5] 🔌 Diagnose DXP Connection Status${C_RESET}`
  );
  console.log(`  ${C_BOLD}${C_RED}[6] ❌ Exit${C_RESET}`);
  console.log(
    `${C_CYAN}----------------------------------------------------------------------${C_RESET}`
  );
  rl.question(`${C_BOLD}👉 Select an option (1-6): ${C_RESET}`, handleChoice);
}

function waitAndReturn() {
  rl.question(
    `\n${C_BOLD}Press Enter to return to main menu...${C_RESET}`,
    () => {
      mainMenu();
    }
  );
}

function handleChoice(choice) {
  const trimmed = choice.trim();
  switch (trimmed) {
    case '1':
      startControlPanel(() => {
        waitAndReturn();
      });
      break;
    case '2':
      rl.question(
        `\n${C_BOLD}❓ Seeding with mock data. Proceed? (y/n): ${C_RESET}`,
        (ans) => {
          if (ans.toLowerCase().startsWith('y')) {
            runCli(['generate', '--demo'], waitAndReturn);
          } else {
            mainMenu();
          }
        }
      );
      break;
    case '3':
      rl.question(
        `\n${C_BOLD}❓ Seeding with AI data. Proceed? (y/n): ${C_RESET}`,
        (ans) => {
          if (ans.toLowerCase().startsWith('y')) {
            runCli(['generate'], waitAndReturn);
          } else {
            mainMenu();
          }
        }
      );
      break;
    case '4':
      rl.question(
        `\n${C_BOLD}⚠️  This will delete all catalogs, accounts, and session data. Are you sure? (y/n): ${C_RESET}`,
        (ans) => {
          if (ans.toLowerCase().startsWith('y')) {
            runCli(['delete', '--all'], waitAndReturn);
          } else {
            mainMenu();
          }
        }
      );
      break;
    case '5':
      runCli(['connect'], waitAndReturn);
      break;
    case '6':
      console.log(`\n${C_CYAN}Goodbye! 👋${C_RESET}\n`);
      process.exit(0);
      break;
    default:
      console.log(
        `\n${C_RED}❌ Invalid selection. Please enter a number between 1 and 6.${C_RESET}`
      );
      setTimeout(mainMenu, 1500);
      break;
  }
}

// Start launcher
mainMenu();
