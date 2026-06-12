import { test, expect } from '@playwright/test';
import path from 'path';
import { injectAndConnectApp } from './test-helper.js';

test.describe('AICA Import & Export Verification', () => {
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

  test('should export current configuration parameters successfully', async ({
    page,
  }) => {
    // 1. Target the Params Export button (which exports the configuration)
    const exportBtn = page
      .getByRole('button', {
        name: 'Export',
        exact: true,
      })
      .first();
    await expect(exportBtn).toBeVisible();

    // 2. Click the export button and intercept the file download
    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();
    const download = await downloadPromise;

    // 3. Verify download was initiated and check filename
    const pathValue = await download.path();
    expect(pathValue).toBeDefined();
    expect(download.suggestedFilename()).toMatch(
      /(ai-commerce-accelerator-config|aica-config)-.*\.json/
    );
  });

  test('should import a valid configuration file successfully', async ({
    page,
  }) => {
    // 1. Locate the hidden file input element for config import
    const fileInput = page.locator('input#configImport');
    await expect(fileInput).toBeAttached();

    // 2. Prepare a mock configuration file to import
    const mockConfigPath = path.resolve(
      __dirname,
      '../../../resources/sample-config-import.json'
    );

    await fileInput.setInputFiles(mockConfigPath);

    // 3. Check for the clay notification with configuration import success text
    const alert = page
      .getByText(/Configuration imported successfully/i)
      .first();
    await expect(alert).toBeVisible({ timeout: 15000 });
  });

  test('should export a successful generation run dataset from the SessionSelectorModal', async ({
    page,
  }) => {
    // 1. Locate and click the Dataset Export Button in the navbar
    const exportTriggerBtn = page
      .getByRole('button', {
        name: 'Export',
        exact: true,
      })
      .last(); // The second export button is for datasets
    await expect(exportTriggerBtn).toBeVisible();
    await exportTriggerBtn.click();

    // 2. Verify that the Session Selector Modal is visible
    const modalHeader = page
      .locator('.modal-content')
      .getByText(/Export AI Dataset/i);
    await expect(modalHeader).toBeVisible({ timeout: 15000 });

    // 3. Select the first successful session row and click Export, intercepting download
    const rowExportBtn = page
      .locator('.modal-content')
      .getByTitle('Export this dataset')
      .first();
    await expect(rowExportBtn).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await rowExportBtn.click();
    const download = await downloadPromise;

    // 4. Verify download initiated successfully and matches format
    const pathValue = await download.path();
    expect(pathValue).toBeDefined();
    expect(download.suggestedFilename()).toMatch(/aica-dataset-.*\.json/);
  });
});
