const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

/**
 * E2E Test Orchestrator
 * This script starts the microservice, monitors its health, and then
 * triggers the Playwright test suite.
 */

const MICROSERVICE_DIR = path.join(
  __dirname,
  "../client-extensions/ai-commerce-accelerator-microservice",
);
const LOG_DIR = path.join(__dirname, "../logs");
const MS_LOG_FILE = path.join(LOG_DIR, "e2e-microservice.log");

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

// Clear old logs
if (fs.existsSync(MS_LOG_FILE)) {
  fs.unlinkSync(MS_LOG_FILE);
}

const logStream = fs.createWriteStream(MS_LOG_FILE, { flags: "a" });

let msProcess = null;

async function startMicroservice() {
  console.log(">>> Starting Microservice in E2E mode...");

  msProcess = spawn("node", ["server.cjs"], {
    cwd: MICROSERVICE_DIR,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: 3000,
    },
  });

  msProcess.stdout.pipe(logStream);
  msProcess.stderr.pipe(logStream);

  msProcess.on("error", (err) => {
    console.error("FAILED to start microservice:", err);
    process.exit(1);
  });

  return new Promise((resolve, reject) => {
    const checkHealth = () => {
      const req = http.get("http://localhost:3000/health", (res) => {
        if (res.statusCode === 200) {
          console.log(">>> Microservice is HEALTHY.");
          resolve();
        } else {
          setTimeout(checkHealth, 500);
        }
      });

      req.on("error", () => {
        setTimeout(checkHealth, 500);
      });
    };

    checkHealth();

    // Timeout after 30 seconds
    setTimeout(() => {
      reject(new Error("Microservice failed to become healthy within 30s"));
    }, 30000);
  });
}

async function runPlaywright() {
  console.log(">>> Running Playwright Tests...");

  return new Promise((resolve) => {
    const pw = spawn(
      "npx",
      ["playwright", "test", "--config=playwright-e2e.config.js"],
      {
        stdio: "inherit",
        shell: true,
      },
    );

    pw.on("exit", (code) => {
      resolve(code);
    });
  });
}

function cleanup() {
  if (msProcess) {
    console.log(">>> Shutting down Microservice...");
    msProcess.kill();
  }
}

async function main() {
  try {
    await startMicroservice();
    const exitCode = await runPlaywright();

    // Analyze logs for FATAL or ERROR
    console.log(">>> Analyzing Microservice logs for errors...");
    const logs = fs.readFileSync(MS_LOG_FILE, "utf8");
    const fatalMatch = logs.match(/FATAL|ERROR/i);

    if (fatalMatch) {
      console.error("FAIL: Detected server-side errors in microservice logs!");
      process.exit(1);
    }

    if (exitCode !== 0) {
      console.error(`FAIL: Playwright suite exited with code ${exitCode}`);
      process.exit(exitCode);
    }

    console.log(">>> E2E Verification SUCCESSFUL.");
    process.exit(0);
  } catch (err) {
    console.error("FATAL ERROR in Orchestrator:", err.message);
    cleanup();
    process.exit(1);
  }
}

// Ensure cleanup on various exit signals
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

main();
