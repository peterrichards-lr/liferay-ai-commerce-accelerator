import { test, expect } from '@playwright/test';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

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

test.describe('AICA Price List Teardown Locks E2E', () => {
  test.use({ storageState: '.auth/user.json' });

  const aicaBin = path.resolve(__dirname, '../../../scripts/aica-cli.cjs');

  test('should bypass catalogBasePriceList lock during teardown', async ({
    request,
  }) => {
    test.setTimeout(300000); // 5 minutes timeout

    const user = process.env.LIFERAY_USER || 'test@liferay.com';
    const password = process.env.LIFERAY_PASSWORD || 'test';
    const credentials = Buffer.from(`${user}:${password}`).toString('base64');
    const authHeader = { Authorization: `Basic ${credentials}` };
    const liferayUrl = process.env.BASE_URL || 'http://127.0.0.1:8080';

    // 1. Generate minimal data including price lists to acquire lock
    console.log(
      'Generating minimal test data (price lists) to acquire catalog lock...'
    );
    let stdout = await runCliCommand(
      `${aicaBin} generate --demo --products 1 --accounts 0 --orders 0`
    );
    expect(stdout).toContain('Success! Session successfully completed');

    // 2. Execute delete --all (this will trigger the RESET_CATALOG_CONFIG block to dynamically release the locks)
    console.log('Running delete --all to trigger teardown lock bypass...');
    stdout = await runCliCommand(`${aicaBin} delete --all`);
    expect(stdout).toContain('Success! Session successfully completed');

    // 3. Verify that all AICA price lists are deleted and lock was cleanly bypassed
    console.log('Verifying lock was bypassed and AICA lists are deleted...');
    const res = await request.get(
      `${liferayUrl}/o/headless-commerce-admin-pricing/v2.0/price-lists`,
      { headers: authHeader }
    );
    expect(res.status()).toBe(200);
    const data = await res.json();

    const anyAicaList = data.items.find((pl) =>
      pl.externalReferenceCode.startsWith('AICA-')
    );
    expect(anyAicaList).toBeUndefined(); // All AICA lists should be cleanly deleted
  });
});
