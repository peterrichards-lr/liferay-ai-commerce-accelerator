import { expect } from '@playwright/test';

/**
 * Common setup helper to navigate to the guest page, inject the React custom element,
 * establish a connection, and wait for commerce channel indexing to complete.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function injectAndConnectApp(page) {
  console.log(
    '>>> Navigating to standard Guest page to inject React application...'
  );

  // Log all browser console messages for debugging
  page.on('console', (msg) => {
    console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });
  page.on('pageerror', (exception) =>
    console.log(`[Browser Exception] ${exception}`)
  );
  page.on('requestfailed', (request) => {
    console.log(
      `[Network Error] ${request.url()} - ${request.failure()?.errorText}`
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.log(`[Network 4xx/5xx] ${response.status()} - ${response.url()}`);
    }
  });

  // 1. Go to the highly-stable default AICA page, or fallback to Guest Home page
  console.log('>>> Navigating to AICA site page...');
  const res = await page.goto('/web/aica').catch(() => null);
  if (!res || res.status() >= 400) {
    console.log(
      '>>> AICA site page not found/unreachable. Falling back to Guest page...'
    );
    await page.goto('/web/guest');
  }

  // Resolve Liferay URL dynamically from environment configuration
  const liferayUrl = process.env.BASE_URL || 'http://localhost:8080';
  console.log(`>>> Injecting custom element with liferay-url: ${liferayUrl}`);

  // 2. Dynamically inject the Custom Element into the DOM.
  await page.evaluate(async (url) => {
    // Only inject if it doesn't already exist from a previous test run on this page
    if (!document.querySelector('liferay-ai-commerce-accelerator-frontend')) {
      const el = document.createElement(
        'liferay-ai-commerce-accelerator-frontend'
      );
      el.setAttribute('liferay-hosted', 'true');
      el.setAttribute('liferay-url', url);
      el.setAttribute('microservice-url', 'http://localhost:3001');
      el.setAttribute(
        'locale-code',
        window.themeDisplay
          ? window.themeDisplay.getLanguageId().replace('_', '-')
          : 'en-US'
      );
      if (window.themeDisplay) {
        el.setAttribute(
          'site-group-id',
          String(window.themeDisplay.getScopeGroupId())
        );
      }

      // Force layout sizing so Playwright can interact with it
      el.style.display = 'block';
      el.style.minHeight = '800px';
      el.style.width = '100%';
      el.style.position = 'relative';
      el.style.zIndex = '9999';
      el.style.backgroundColor = '#fff';

      document.body.prepend(el);

      // Force the browser to resolve and execute the React bundle from the import map
      // Retry until Liferay's import map is fully injected
      let retries = 50;
      while (retries > 0) {
        try {
          await import('liferay-ai-commerce-accelerator-frontend');
          break;
        } catch (e) {
          retries--;
          await new Promise((r) => setTimeout(r, 100));
          if (retries === 0) throw e;
        }
      }
    }
  }, liferayUrl);

  // 3. Wait for the React fragment to lazy-load and render the dashboard
  await expect(page.locator('.ai-commerce-dashboard')).toBeVisible({
    timeout: 15000,
  });

  // 3.5 Dismiss Liferay Enterprise Search modal if it appears
  const modalDoneBtn = page.getByRole('button', { name: 'Done', exact: true });
  if (await modalDoneBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await modalDoneBtn.click();
    await expect(modalDoneBtn).toBeHidden({ timeout: 5000 });
  }

  // 4. Click 'Test Connection' and retry if it fails (e.g., Liferay background re-indexing returning 401)
  let connected = false;
  for (let i = 0; i < 10; i++) {
    const connectBtn = page.getByRole('button', {
      name: /(Test Connection & Load Data|Retry Connection)/i,
    });
    if (await connectBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await connectBtn.click();
    }

    // Wait for the UI to unlock by checking the button text!
    try {
      await expect(
        page.getByRole('button', { name: /Connected/i })
      ).toBeVisible({ timeout: 5000 });
      connected = true;
      break;
    } catch (e) {
      // Failed to connect this attempt, loop and retry
    }
  }

  if (!connected) {
    throw new Error('Failed to connect to Liferay after multiple attempts.');
  }

  // 4.5. Wait for the Channel dropdown to not display "No channels found"
  // Since Liferay Commerce channels may take 1-2 minutes to be created and indexed on startup.
  console.log('>>> Waiting for Channel dropdown to be populated...');
  const channelDropdown = page.getByLabel('Channel', { exact: true });
  await expect(channelDropdown).toBeVisible({ timeout: 15000 });

  for (let j = 0; j < 24; j++) {
    const optionsText = await channelDropdown.textContent().catch(() => '');
    if (optionsText && !optionsText.includes('No channels found')) {
      console.log('>>> Channel dropdown successfully populated!');
      break;
    }

    console.log(
      `>>> [Attempt ${j + 1}/24] Channel dropdown still empty/indexing. Retrying connection...`
    );
    const retryBtn = page.getByRole('button', { name: /Retry Connection/i });
    if (await retryBtn.isVisible().catch(() => false)) {
      await retryBtn.click();
    } else {
      const connectedBtn = page.getByRole('button', { name: /Connected/i });
      if (await connectedBtn.isVisible().catch(() => false)) {
        await connectedBtn.click();
      }
    }
    await page.waitForTimeout(5000);
  }

  await expect(channelDropdown).not.toContainText('No channels found', {
    timeout: 30000,
  });

  // 5. Clear any lingering workflow status from previous tests so the form isn't locked
  const clearStatusBtn = page.getByRole('button', {
    name: /Clear Workflow Status/i,
  });
  if (await clearStatusBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await clearStatusBtn.click();
  }
}
