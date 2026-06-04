import { test, expect } from '@playwright/test';
import path from 'path';
import { injectAndConnectApp } from './test-helper.js';

test.describe('AICA Dataset Import Verification', () => {
  test.use({ storageState: '.auth/user.json' });

  test.beforeEach(async ({ page }) => {
    await injectAndConnectApp(page);
  });

  test('should import a commerce dataset and verify import log message', async ({
    page,
  }) => {
    // 1. Locate the hidden file input element for dataset import
    const fileInput = page.locator('input#datasetImport');
    await expect(fileInput).toBeAttached();

    // 2. Upload the sample JSON
    const samplePath = path.resolve(
      __dirname,
      '../../../resources/sample-import.json'
    );
    await fileInput.setInputFiles(samplePath);

    // 3. Verify the activity log shows that the dataset import was selected
    const progressOutput = page.locator('.console-body');
    await expect(progressOutput).toContainText(/Dataset import selected/i, {
      timeout: 15000,
    });
  });
});
