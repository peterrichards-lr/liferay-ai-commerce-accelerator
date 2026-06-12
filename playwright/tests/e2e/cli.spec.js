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
      `../../../test-results/cli-export-latest.json`
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

  test('should successfully import and re-scaffold a dataset using config import', async () => {
    test.setTimeout(120000);

    const tempExportPath = path.resolve(
      __dirname,
      `../../../test-results/cli-export-latest.json`
    );
    expect(fs.existsSync(tempExportPath)).toBe(true);

    const stdout = await runCliCommand(`${aicaBin} import ${tempExportPath}`);

    expect(stdout).toContain('Reading dataset from');
    expect(stdout).toContain('Uploading dataset payload to target DXP');
    expect(stdout).toContain('Import Scaffolding Started');
    expect(stdout).toContain('Progress:');
    expect(stdout).toContain('Success! Session successfully completed');
  });

  test('should successfully retrieve current configuration using config get', async () => {
    const stdout = await runCliCommand(`${aicaBin} config get`);

    expect(stdout).toContain('Retrieving active configuration parameters');

    // Extract and parse JSON block
    const jsonStart = stdout.indexOf('{');
    const jsonStr = stdout.slice(jsonStart);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.config).toBeDefined();
    expect(parsed.generationConfig).toBeDefined();
    expect(parsed.batchSizes).toBeDefined();
  });

  test('should successfully import bulk configuration using config set', async () => {
    const configPath = path.resolve(
      __dirname,
      '../../../resources/sample-config-import.json'
    );
    expect(fs.existsSync(configPath)).toBe(true);

    const setStdout = await runCliCommand(
      `${aicaBin} config set ${configPath}`
    );
    expect(setStdout).toContain('Reading configuration from');
    expect(setStdout).toContain('Configuration updated successfully');

    // Retrieve and verify that products target count was updated to 10
    const getStdout = await runCliCommand(`${aicaBin} config get`);
    const jsonStart = getStdout.indexOf('{');
    const parsed = JSON.parse(getStdout.slice(jsonStart));
    expect(parsed.generationConfig.productCount).toBe(10);
  });

  test('should successfully update single key-value property using config set', async () => {
    const setStdout = await runCliCommand(
      `${aicaBin} config set --key productCount --value 15`
    );
    expect(setStdout).toContain('Updating single property "productCount"');
    expect(setStdout).toContain('Configuration updated successfully');

    // Retrieve and verify that products target count was updated to 15
    const getStdout = await runCliCommand(`${aicaBin} config get`);
    const jsonStart = getStdout.indexOf('{');
    const parsed = JSON.parse(getStdout.slice(jsonStart));
    expect(parsed.generationConfig.productCount).toBe(15);
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
