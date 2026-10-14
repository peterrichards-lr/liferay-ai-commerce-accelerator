import { test, expect } from '../../fixtures/diagnostics.js';

test('frontend renders main title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Liferay Commerce AI|Liferay/i);
});
