import { test, expect } from '@playwright/test';

test.describe('AICA End-to-End Verification', () => {
  test.use({ storageState: '.auth/user.json' });

  test.beforeEach(async ({ page }) => {
    // Navigate to the dashboard page with retry logic for 404s (Site Initializer delay)
    await expect(async () => {
      const response = await page.goto('/web/guest/data-generator');
      expect(response.status()).toBe(200);
    }).toPass({
      timeout: 120000,
      intervals: [5000, 10000],
    });

    // Handle persistent Terms of Use modal
    const termsModal = page.getByRole('dialog', { name: /Terms of Use/i });
    const termsHeading = termsModal.getByRole('heading', {
      name: /Terms of Use/i,
    });

    if (await termsHeading.isVisible({ timeout: 15000 }).catch(() => false)) {
      console.log('>>> Dismissing Terms of Use modal on dashboard...');
      await termsModal.getByRole('button', { name: 'Done' }).click();
      await termsModal.waitFor({ state: 'hidden', timeout: 15000 });
    }

    await page.waitForSelector('.aica-dashboard', { timeout: 60000 });
  });

  test('should perform full data deletion flow', async ({ page }) => {
    // 1. Locate and click Delete All Data
    const deleteBtn = page.getByRole('button', { name: /Delete All Data/i });
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // 2. Confirm in the dialog
    const confirmBtn = page.getByRole('button', {
      name: /Yes, Delete Everything/i,
    });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // 3. Monitor Progress
    // We expect the Overall Progress gauge to reach 100%
    const progressGauge = page.locator('.overall-gauge-container');
    await expect(progressGauge).toContainText('100%', { timeout: 60000 });

    // 4. Verify Success log
    const console = page.locator('.console-body');
    await expect(console).toContainText(/Workflow completed/i, {
      timeout: 10000,
    });
  });

  test('should perform data generation flow in Demo Mode', async ({ page }) => {
    // 1. Ensure Demo Mode is active
    const demoToggle = page.getByLabel(/Demo Mode/i);
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

  test('should persist and resume active session on page reload', async ({
    page,
  }) => {
    // 1. Ensure Demo Mode is active to avoid external API calls during E2E
    const demoToggle = page.getByLabel(/Demo Mode/i);
    if (!(await demoToggle.isChecked())) {
      await demoToggle.check();
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

    // 3. Trigger Generation
    const generateBtn = page.getByRole('button', { name: /Generate/i });
    await generateBtn.click();

    // 4. Wait for the workflow to begin (Gauge > 0%)
    const progressGauge = page.locator('.overall-gauge-container');
    await expect(progressGauge).not.toContainText('0%', { timeout: 15000 });

    // 5. Reload the page mid-flight
    await page.reload();

    // 6. Verify the UI correctly hydrates the running session state
    // The "Generate" button should be disabled (replaced by Cancel)
    await expect(page.getByRole('button', { name: /Generate/i })).toBeDisabled({
      timeout: 10000,
    });

    // The Connection button should still show 'Connected'
    await expect(
      page.getByRole('button', { name: /Connected/i })
    ).toBeVisible();

    // 7. Verify the process eventually completes
    await expect(progressGauge).toContainText('100%', { timeout: 120000 });
    const console = page.locator('.console-body');
    await expect(console).toContainText(/Workflow completed/i);
  });
});
