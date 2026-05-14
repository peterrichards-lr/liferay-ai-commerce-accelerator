import { test as setup, expect } from '@playwright/test';
import path from 'path';

const STORAGE_STATE = path.join(__dirname, '../../playwright/.auth/user.json');

setup('authenticate', async ({ page }) => {
  const user = process.env.LIFERAY_USER || 'test@liferay.com';
  const password = process.env.LIFERAY_PASSWORD || 'L1feray$';

  // Navigate to Liferay login
  await page.goto('/c/portal/login');

  // Perform login
  await page.getByLabel('Email Address').fill(user);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Wait for landing page
  await expect(page).toHaveTitle(/Home/i);

  // Save storage state
  await page.context().storageState({ path: STORAGE_STATE });
});
