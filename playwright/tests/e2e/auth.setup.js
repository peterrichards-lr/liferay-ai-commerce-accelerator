import { test as setup, expect } from '@playwright/test';
import path from 'path';

const STORAGE_STATE = path.join(__dirname, '../../.auth/user.json');

setup('authenticate', async ({ page }) => {
  const user = process.env.LIFERAY_USER || 'test@liferay.com';
  const password = process.env.LIFERAY_PASSWORD || 'test';

  console.log(`>>> Authenticating user: ${user}`);

  // Navigate to Liferay login
  await page.goto('/c/portal/login');

  // Handle DXP 2024+ where /c/portal/login might redirect to home with a Sign In button
  const emailInput = page.getByLabel('Email Address');
  if (!(await emailInput.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log(
      '>>> Email input not immediately visible, looking for Sign In link...'
    );
    const signInLink = page.getByRole('link', { name: /Sign In/i });
    if (await signInLink.isVisible()) {
      await signInLink.click();
    }
  }

  // Perform login
  await emailInput.fill(user);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Wait for landing page or user avatar to confirm login
  await expect(
    page.locator(
      '.user-avatar-image, .user-avatar-initials, .personal-menu-dropdown'
    )
  ).toBeVisible({ timeout: 30000 });

  console.log('>>> Authentication SUCCESSFUL.');

  // Auto-provision Catalog and Channel if none exist in the database
  const requestContext = page.request;
  const authHeader = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

  console.log('>>> Checking for existing commerce channels...');
  try {
    const channelsResponse = await requestContext.get(
      '/o/headless-commerce-admin-channel/v1.0/channels',
      {
        headers: { Authorization: authHeader },
      }
    );

    if (channelsResponse.ok()) {
      const channelsData = await channelsResponse.json();
      if (channelsData.totalCount === 0) {
        console.log(
          '>>> No commerce channels found. Auto-provisioning catalog and channel...'
        );

        // 1. Create default Catalog
        const catalogRes = await requestContext.post(
          '/o/headless-commerce-admin-catalog/v1.0/catalogs',
          {
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
            },
            data: {
              name: 'Master',
              defaultLanguageId: 'en_US',
              currencyCode: 'USD',
            },
          }
        );

        if (catalogRes.ok()) {
          const catalogData = await catalogRes.json();
          console.log(
            `>>> Successfully provisioned default Catalog "Master" (ID: ${catalogData.id}).`
          );
        } else {
          console.log(
            `>>> WARNING: Failed to provision Catalog: ${catalogRes.status()} ${await catalogRes.text()}`
          );
        }

        // 2. Create default Channel
        const channelRes = await requestContext.post(
          '/o/headless-commerce-admin-channel/v1.0/channels',
          {
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
            },
            data: {
              name: 'Web Store',
              type: 'site',
              currencyCode: 'USD',
            },
          }
        );

        if (channelRes.ok()) {
          const channelData = await channelRes.json();
          console.log(
            `>>> Successfully provisioned default Channel "Web Store" (ID: ${channelData.id}).`
          );
        } else {
          console.log(
            `>>> WARNING: Failed to provision Channel: ${channelRes.status()} ${await channelRes.text()}`
          );
        }
      } else {
        console.log(
          `>>> Found ${channelsData.totalCount} existing commerce channel(s).`
        );
      }
    } else {
      console.log(
        `>>> WARNING: Failed to query channels: ${channelsResponse.status()}`
      );
    }
  } catch (err) {
    console.log(
      `>>> WARNING: Error during commerce auto-provisioning: ${err.message}`
    );
  }

  // Save storage state
  await page.context().storageState({ path: STORAGE_STATE });
});
