import { test, expect } from '@playwright/test';

test.describe('AICA End-to-End Verification', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test.beforeEach(async ({ page }) => {
    // Navigate to the dashboard page
    // Note: Adjust the path if the dashboard sits elsewhere in your specific DXP setup
    await page.goto('http://localhost:8080/group/guest/ai-commerce-accelerator');
  });

  test('should perform full data deletion flow', async ({ page }) => {
    // 1. Locate and click Delete All Data
    const deleteBtn = page.getByRole('button', { name: /Delete All Data/i });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // 2. Confirm in the dialog
    const confirmBtn = page.getByRole('button', { name: /Yes, Delete Everything/i });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 3. Monitor Progress
    // We expect the Overall Progress gauge to reach 100%
    const progressGauge = page.locator('.overall-gauge-container');
    await expect(progressGauge).toContainText('100%', { timeout: 60000 });

    // 4. Verify Success log
    const console = page.locator('.console-body');
    await expect(console).toContainText(/Workflow completed/i, { timeout: 10000 });
  });

  test('should perform data generation flow in Demo Mode', async ({ page }) => {
    // 1. Ensure Demo Mode is active
    const demoToggle = page.getByLabel(/Demo Mode/i);
    if (!(await demoToggle.isChecked())) {
      await demoToggle.check();
    }

    // 2. Set counts for quick test
    await page.getByLabel(/Products/i).first().fill('2');
    await page.getByLabel(/Accounts/i).first().fill('2');
    await page.getByLabel(/Orders/i).first().fill('5');

    // 3. Trigger Generation
    const generateBtn = page.getByRole('button', { name: /Generate/i });
    await generateBtn.click();

    // 4. Monitor Progress
    const progressGauge = page.locator('.overall-gauge-container');
    await expect(progressGauge).toContainText('100%', { timeout: 120000 });

    // 5. Verify Console logs
    const console = page.locator('.console-body');
    await expect(console).toContainText(/Workflow completed/i);
    await expect(console).not.toContainText(/ERROR/i);
  });
});
