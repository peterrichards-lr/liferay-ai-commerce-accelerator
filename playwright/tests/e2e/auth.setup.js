import { test as setup, expect } from '@playwright/test';
import path from 'path';

const STORAGE_STATE = path.join(__dirname, '../../.auth/user.json');

// `locator.isVisible({ timeout })` does not wait - it samples the DOM once and
// returns - so the login form only ever had whatever time page.goto happened to
// leave on the clock. waitFor is the retrying form, and is what "wait up to 5s
// for the field" was always meant to say.
async function becomesVisible(locator, timeout) {
  return locator
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
}

// A DXP instance whose activation key is missing or expired answers every
// request with its activation page, login included. Waiting 60s for an email
// field on that page and reporting `locator.fill: waiting for
// getByLabel('Email Address')` describes the symptom and hides the cause; the
// nightly reported exactly that, on all three shards, after 1h55m each.
// Whatever the login page turns out to be, say what it was.
async function failWithLoginPageDiagnosis(page) {
  const url = page.url();
  const body = await page
    .locator('body')
    .innerText()
    .catch(() => '');

  if (
    body.includes('This instance is not registered') ||
    body.includes('Liferay DXP Activation')
  ) {
    throw new Error(
      `Liferay DXP is not activated. ${url} served the "Liferay DXP Activation" ` +
        'page instead of the login form, so no test in this suite can sign in. ' +
        "The docker image's built-in trial licence expires 30 days after the " +
        'release it was built from, and scripts/run-e2e-ldm.sh deploys no ' +
        'activation key, so the environment cannot become registered on its own.'
    );
  }

  const heading = await page
    .locator('h1, h2')
    .first()
    .innerText()
    .catch(() => '');

  throw new Error(
    `No Liferay login form at ${url}. Page title: ` +
      `"${await page.title().catch(() => '')}"; first heading: "${heading}". ` +
      'The suite cannot authenticate, so every spec would report a ' +
      'consequence of this rather than its own result.'
  );
}

setup('authenticate', async ({ page }) => {
  const user = process.env.LIFERAY_USER || 'test@liferay.com';
  const password = process.env.LIFERAY_PASSWORD || 'test';

  console.log(`>>> Authenticating user: ${user}`);

  // Navigate to Liferay login
  await page.goto('/c/portal/login');

  // Handle DXP 2024+ where /c/portal/login might redirect to home with a Sign In button
  const emailInput = page.getByLabel('Email Address');
  if (!(await becomesVisible(emailInput, 5000))) {
    console.log(
      '>>> Email input not immediately visible, looking for Sign In link...'
    );
    const signInLink = page.getByRole('link', { name: /Sign In/i });
    if (await signInLink.isVisible()) {
      await signInLink.click();
    }
  }

  if (!(await becomesVisible(emailInput, 15000))) {
    await failWithLoginPageDiagnosis(page);
  }

  // Perform login
  await emailInput.fill(user);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // --- DETECT AND BYPASS FIRST-BOOT SETUP WIZARDS ---

  // 1. Detect and bypass "Terms of Use" page
  try {
    const agreeButton = page.getByRole('button', { name: /Agree/i });
    if (await agreeButton.isVisible({ timeout: 5000 })) {
      console.log(
        '>>> [Setup Wizard] Terms of Use page detected. Clicking Agree...'
      );
      await agreeButton.click();
      await page.waitForLoadState('load').catch(() => {});
    }
  } catch (e) {}

  // 2. Detect and bypass "Change Password" page
  try {
    const newPasswordInput = page.locator('input[type="password"]').first();
    const confirmPasswordInput = page.locator('input[type="password"]').nth(1);
    const saveBtn = page.getByRole('button', { name: /Save|Submit/i }).first();
    if (
      (await newPasswordInput.isVisible({ timeout: 5000 })) &&
      (await saveBtn.isVisible({ timeout: 1000 }))
    ) {
      console.log(
        '>>> [Setup Wizard] Change Password page detected. Saving new password...'
      );
      await newPasswordInput.fill(password);
      await confirmPasswordInput.fill(password);
      await saveBtn.click();
      await page.waitForLoadState('load').catch(() => {});
    }
  } catch (e) {}

  // 3. Detect and bypass "Password Reminder Question" page
  try {
    const reminderInput = page.locator('input[type="text"]').first();
    const saveBtn = page.getByRole('button', { name: /Save|Submit/i }).first();
    if (
      (await reminderInput.isVisible({ timeout: 5000 })) &&
      (await saveBtn.isVisible({ timeout: 1000 }))
    ) {
      console.log(
        '>>> [Setup Wizard] Password Reminder page detected. Saving answer...'
      );
      await reminderInput.fill('testanswer');
      await saveBtn.click();
      await page.waitForLoadState('load').catch(() => {});
    }
  } catch (e) {}

  // Wait for landing page or user avatar to confirm login
  await expect(
    page
      .locator(
        '.user-avatar-image, .user-avatar-initials, .personal-menu-dropdown'
      )
      .or(page.getByRole('button', { name: /User Profile/i }))
      .first()
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
