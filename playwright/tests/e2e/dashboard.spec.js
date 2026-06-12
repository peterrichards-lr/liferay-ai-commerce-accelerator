import { test, expect } from '@playwright/test';
import { injectAndConnectApp } from './test-helper.js';

test.describe('AICA End-to-End Verification', () => {
  test.use({ storageState: '.auth/user.json' });

  test.beforeEach(async ({ page }) => {
    await injectAndConnectApp(page);
  });

  test('should perform full data deletion flow', async ({ page }) => {
    // 0. Open Advanced Options
    const advancedOptionsBtn = page.getByRole('button', {
      name: /Advanced Options/i,
    });
    await advancedOptionsBtn.click();

    // 1. Locate and click Delete All Data
    const deleteBtn = page.getByRole('button', {
      name: /Delete All Commerce Data/i,
    });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // 2. Confirm in the dialog
    const confirmBtn = page.locator('.modal-content').getByRole('button', {
      name: 'Delete',
      exact: true,
    });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 3. Monitor Progress
    // We expect the Overall Progress gauge to reach 100%
    const progressGauge = page.locator('.overall-gauge-container');
    await expect(progressGauge).toContainText('100%', { timeout: 60000 });

    // 4. Verify Success log
    const console = page.locator('.console-body');
    await expect(console).toContainText(/Deletion session completed/i, {
      timeout: 10000,
    });

    // Settle Delay: Give Liferay DXP indexers 10 seconds to fully settle and sync deletions
    await page.waitForTimeout(10000);
  });

  test('should perform data generation flow in Demo Mode', async ({ page }) => {
    test.setTimeout(300000);
    // 1. Ensure Demo Mode is active
    const demoToggle = page.getByLabel(/Toggle Data Generation Mode/i);
    if (await demoToggle.isChecked()) {
      await demoToggle.uncheck();
    }

    // 2. Set counts for quick test
    await page
      .getByLabel(/Products/i)
      .first()
      .fill('2');
    await page
      .getByLabel(/Accounts/i)
      .first()
      .fill('2');
    await page
      .getByLabel(/Orders/i)
      .first()
      .fill('5');

    // Ensure we create a fresh warehouse since database is clean
    const warehouseCheckbox = page.getByLabel(/Create Warehouses/i).first();
    if (!(await warehouseCheckbox.isChecked())) {
      await warehouseCheckbox.check();
    }

    // 3. Trigger Generation
    const generateBtn = page.getByRole('button', {
      name: /Start (Demo )?Generation/i,
    });
    await expect(generateBtn).toBeEnabled({ timeout: 15000 });
    await generateBtn.click();

    // 4. Monitor Progress
    const progressGauge = page.locator('.overall-gauge-container');
    await expect(progressGauge).toContainText('100%', { timeout: 300000 });

    // 5. Verify Console logs
    const console = page.locator('.console-body');
    await expect(console).toContainText(/Workflow submitted successfully/i);
    await expect(console).not.toContainText(/ERROR/i);
  });

  test('should perform data generation flow in Live (AI) Mode', async ({
    page,
  }) => {
    // Check if AI keys are present. If not, gracefully skip this test!
    const hasApiKey = !!(
      process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY
    );
    if (!hasApiKey) {
      test.skip(
        'Skipping Live Mode test because no AI API key is defined in the environment.'
      );
    }

    test.setTimeout(300000);

    // 1. Ensure Live Mode is active
    const demoToggle = page.getByLabel(/Toggle Data Generation Mode/i);
    if (!(await demoToggle.isChecked())) {
      await demoToggle.check();
    }

    // 2. Set counts for quick test
    await page
      .getByLabel(/Products/i)
      .first()
      .fill('2');
    await page
      .getByLabel(/Accounts/i)
      .first()
      .fill('2');
    await page
      .getByLabel(/Orders/i)
      .first()
      .fill('5');

    // Ensure we create a fresh warehouse since database is clean
    const warehouseCheckbox = page.getByLabel(/Create Warehouses/i).first();
    if (!(await warehouseCheckbox.isChecked())) {
      await warehouseCheckbox.check();
    }

    // 3. Trigger Generation
    const generateBtn = page.getByRole('button', {
      name: /Start (Live )?Generation/i,
    });
    await expect(generateBtn).toBeEnabled({ timeout: 15000 });
    await generateBtn.click();

    // 4. Monitor Progress
    const progressGauge = page.locator('.overall-gauge-container');
    await expect(progressGauge).toContainText('100%', { timeout: 300000 });

    // 5. Verify Console logs
    const console = page.locator('.console-body');
    await expect(console).toContainText(/Workflow submitted successfully/i);
    await expect(console).not.toContainText(/ERROR/i);
  });

  test('should persist and resume active session on page reload', async ({
    page,
  }) => {
    test.setTimeout(300000);
    // 1. Ensure Demo Mode is active to avoid external API calls during E2E
    const demoToggle = page.getByLabel(/Toggle Data Generation Mode/i);
    if (await demoToggle.isChecked()) {
      await demoToggle.uncheck();
    }

    // 2. Set slightly higher counts to ensure the workflow doesn't finish before we reload
    await page
      .getByLabel(/Products/i)
      .first()
      .fill('5');
    await page
      .getByLabel(/Accounts/i)
      .first()
      .fill('5');

    // Ensure we create a fresh warehouse since database is clean
    const warehouseCheckbox = page.getByLabel(/Create Warehouses/i).first();
    if (!(await warehouseCheckbox.isChecked())) {
      await warehouseCheckbox.check();
    }

    // 3. Trigger Generation
    const generateBtn = page.getByRole('button', {
      name: /Start (Demo )?Generation/i,
    });
    await expect(generateBtn).toBeEnabled({ timeout: 15000 });
    await generateBtn.click();

    // 4. Wait for the workflow session ID to appear in the console (active session established)
    const console = page.locator('.console-body');
    await expect(console).toContainText(/Workflow submitted successfully/i, {
      timeout: 20000,
    });

    // 5. Reload the page mid-flight immediately to test persistence
    await page.reload();

    // 5.5. Re-inject the app after reload since it was dynamically injected
    await injectAndConnectApp(page);

    // 6. Verify the UI correctly hydrates the running session state
    // Verify the Cancel Generation button is visible and the progress state is active
    await expect(
      page.getByRole('button', { name: 'Cancel Generation' })
    ).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByRole('button', { name: 'Generating...' })
    ).toBeDisabled({
      timeout: 10000,
    });

    // 7. Wait for the workflow to complete to prevent overlap with the deletion test
    const finalGauge = page.locator('.overall-gauge-container');
    await expect(finalGauge).toContainText('100%', { timeout: 300000 });
  });

  test('should perform selected data deletion flow', async ({ page }) => {
    // 0. Open Advanced Options
    const advancedOptionsBtn = page.getByRole('button', {
      name: /Advanced Options/i,
    });
    await advancedOptionsBtn.click();

    // 1. Locate and click Delete Selected Commerce Data
    const deleteBtn = page.getByRole('button', {
      name: /Delete Selected Commerce Data/i,
    });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // 2. Confirm in the dialog
    const confirmBtn = page.locator('.modal-content').getByRole('button', {
      name: 'Delete',
      exact: true,
    });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 3. Monitor Progress
    // We expect the Overall Progress gauge to reach 100%
    const progressGauge = page.locator('.overall-gauge-container');
    await expect(progressGauge).toContainText('100%', { timeout: 60000 });

    // 4. Verify Success log
    const console = page.locator('.console-body');
    await expect(console).toContainText(/Deletion session completed/i, {
      timeout: 10000,
    });
  });

  test('should perform final full data deletion flow cleanup', async ({
    page,
  }) => {
    // 0. Open Advanced Options
    const advancedOptionsBtn = page.getByRole('button', {
      name: /Advanced Options/i,
    });
    await advancedOptionsBtn.click();

    // 1. Locate and click Delete All Data
    const deleteBtn = page.getByRole('button', {
      name: /Delete All Commerce Data/i,
    });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // 2. Confirm in the dialog
    const confirmBtn = page.locator('.modal-content').getByRole('button', {
      name: 'Delete',
      exact: true,
    });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 3. Monitor Progress
    // We expect the Overall Progress gauge to reach 100%
    const progressGauge = page.locator('.overall-gauge-container');
    await expect(progressGauge).toContainText('100%', { timeout: 60000 });

    // 4. Verify Success log
    const console = page.locator('.console-body');
    await expect(console).toContainText(/Deletion session completed/i, {
      timeout: 10000,
    });
  });
});
