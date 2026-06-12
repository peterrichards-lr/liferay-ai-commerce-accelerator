import { test, expect } from '@playwright/test';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

test.describe('AICA Headless CLI Client E2E Verification', () => {
  // Leverage the same authenticated context or credentials
  test.use({ storageState: '.auth/user.json' });

  const aicaBin = path.resolve(__dirname, '../../../scripts/aica-cli.cjs');

  test('should successfully run aica connect handshake', async () => {
    const stdout = await runCliCommand(`${aicaBin} connect`);

    expect(stdout).toContain('Connecting to AICA Microservice');
    expect(stdout).toContain('Handshake Successful');
    expect(stdout).toContain('Connected to Liferay');
  });

  test('should execute aica generate --demo to completion', async () => {
    test.setTimeout(300000); // Allow up to 5 minutes for full generation and polling

    const stdout = await runCliCommand(
      `${aicaBin} generate --demo --products 1 --accounts 1 --orders 3`
    );

    expect(stdout).toContain('Initializing Data Generation');
    expect(stdout).toContain('Generation Workflow Started');
    // Non-TTY logs output single line "Progress" statements
    expect(stdout).toContain('Progress:');
    expect(stdout).toContain('Success! Session successfully completed');
  });

  test('should successfully export the latest dataset to JSON', async () => {
    // 1. Get the sessionId from the logs/database
    const dbPath = path.resolve(
      __dirname,
      '../../../client-extensions/ai-commerce-accelerator-microservice/data/aica.db'
    );
    expect(fs.existsSync(dbPath)).toBe(true);

    // Read latest session from SQLite via quick child process query
    const query = `sqlite3 ${dbPath} "SELECT session_id FROM sessions WHERE flow_type='generate' AND status='COMPLETED' ORDER BY updated_at DESC LIMIT 1;"`;
    const sessionId = (await runCliCommand(query)).trim();
    expect(sessionId).toBeDefined();
    expect(sessionId.startsWith('AICA-SESSION')).toBe(true);

    // 2. Export dataset using the CLI
    const tempExportPath = path.resolve(
      __dirname,
      `../../../test-results/cli-export-${sessionId}.json`
    );
    const stdout = await runCliCommand(
      `${aicaBin} export ${sessionId} ${tempExportPath}`
    );

    expect(stdout).toContain('Exporting session dataset');
    expect(stdout).toContain('Dataset successfully written to disk');
    expect(fs.existsSync(tempExportPath)).toBe(true);

    // 3. Verify JSON content is a valid dataset
    const dataContent = fs.readFileSync(tempExportPath, 'utf8');
    const parsed = JSON.parse(dataContent);
    expect(parsed.products).toBeDefined();
    expect(parsed.accounts).toBeDefined();
  });

  test('should execute aica delete --all to teardown generated data', async () => {
    test.setTimeout(120000);

    const stdout = await runCliCommand(`${aicaBin} delete --all`);

    expect(stdout).toContain('Initializing All Commerce Data Deletion');
    expect(stdout).toContain('Deletion Workflow Started');
    expect(stdout).toContain('Progress:');
    expect(stdout).toContain('Success! Session successfully completed');
  });
});

// Async exec helper
function runCliCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Command failed: ${cmd}\nError: ${error.message}\nStderr: ${stderr}\nStdout: ${stdout}`
          )
        );
        return;
      }
      resolve(stdout);
    });
  });
}
