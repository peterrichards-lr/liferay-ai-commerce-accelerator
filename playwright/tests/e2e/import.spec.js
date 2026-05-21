import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('AICA Dataset Import Verification', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test.beforeEach(async ({ page }) => {
    // Navigate to the dashboard
    await page.goto('/group/guest/ai-commerce-accelerator-admin');
    await page.waitForSelector('.aica-dashboard');
  });

  test('should import a commerce dataset and verify workflow completion', async ({
    page,
  }) => {
    // 1. Open the Import Modal
    const importButton = page.locator('button:has-text("Import Dataset")');
    await importButton.click();

    const modal = page.locator('.clay-modal');
    await expect(modal).toBeVisible();

    // 2. Upload the sample JSON
    const fileInput = modal.locator('input[type="file"]');
    const samplePath = path.resolve('resources/sample-import.json');
    await fileInput.setInputFiles(samplePath);

    // 3. Submit the import
    const submitButton = modal.locator('button.btn-primary:has-text("Import")');
    await submitButton.click();

    // 4. Verify that the modal closes and a new session appears
    await expect(modal).not.toBeVisible();

    // 5. Locate the new session in the list
    const sessionItem = page.locator('.session-item').first();
    await expect(sessionItem).toBeVisible();
    await expect(sessionItem).toContainText('Import');

    // 6. Monitor progress
    const progressGauge = sessionItem.locator('.progress-gauge');

    // Wait for the process to eventually complete (timeout 2 mins)
    await expect(progressGauge).toContainText('100%', { timeout: 120000 });

    const consoleOutput = page.locator('.console-body');
    await expect(consoleOutput).toContainText(/Workflow completed/i);

    // 7. Click on the session to verify details (optional but good for debugging)
    await sessionItem.click();
    await expect(page.locator('.session-detail-view')).toBeVisible();
  });
});
