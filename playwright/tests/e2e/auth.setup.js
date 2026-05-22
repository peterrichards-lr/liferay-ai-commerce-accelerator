import { test as setup, expect } from '@playwright/test';
import path from 'path';

const STORAGE_STATE = path.join(__dirname, '../../.auth/user.json');

setup('authenticate', async ({ page }) => {
  const user = process.env.LIFERAY_USER || 'test@liferay.com';
  const password = process.env.LIFERAY_PASSWORD || 'test';

  console.log(`>>> Authenticating user: ${user}`);

  // Navigate to Liferay login
  await page.goto('/c/portal/login');

  // Perform login
  await page.getByLabel('Email Address').fill(user);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Handle Terms of Use modal if it appears (common on first boot)
  const termsModal = page.getByRole('dialog', { name: /Terms of Use/i });
  const doneBtn = termsModal.getByRole('button', { name: 'Done' });

  if (await termsModal.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('>>> Dismissing Terms of Use modal...');
    await doneBtn.click();
    await termsModal.waitFor({ state: 'hidden' });
  }

  // Wait for landing page or user avatar to confirm login
  await expect(
    page.locator(
      '.user-avatar-image, .user-avatar-initials, .personal-menu-dropdown'
    )
  ).toBeVisible({ timeout: 30000 });

  console.log('>>> Authentication SUCCESSFUL.');

  // Save storage state
  await page.context().storageState({ path: STORAGE_STATE });
});
