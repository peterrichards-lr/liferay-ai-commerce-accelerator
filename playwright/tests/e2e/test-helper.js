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

  // Force all microservice API traffic to hit our local test server, completely
  // bypassing Browser Mixed Content and CORS restrictions.
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const originalUrl = request.url();

    // Extract everything after /api/v1/ and build the localhost URL
    const apiPath = originalUrl.substring(originalUrl.indexOf('/api/v1/'));
    const microserviceUrl =
      process.env.AICA_MICROSERVICE_URL || 'http://localhost:3001';
    const proxyUrl = `${microserviceUrl}${apiPath}`;

    console.log(
      `[Playwright Proxy] Intercepted: ${originalUrl} -> Forwarding to: ${proxyUrl}`
    );

    try {
      const response = await route.fetch({ url: proxyUrl });
      await route.fulfill({ response });
      console.log(`[Playwright Proxy] Success: ${proxyUrl}`);
    } catch (e) {
      console.log(`[Playwright Proxy] Failed: ${e.message}`);
      await route.abort('failed');
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
    let existingEl = document.querySelector(
      'liferay-ai-commerce-accelerator-frontend'
    );
    if (existingEl) {
      existingEl.remove();
    }

    const el = document.createElement(
      'liferay-ai-commerce-accelerator-frontend'
    );

    el.setAttribute('liferay-hosted', 'true');
    el.setAttribute('liferay-url', url);
    el.setAttribute(
      'microservice-url',
      url + '/o/ai-commerce-accelerator-microservice'
    );
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
  }, liferayUrl);

  // 3. Wait for the React fragment to lazy-load and render the dashboard
  await expect(page.locator('.ai-commerce-dashboard')).toBeVisible({
    timeout: 15000,
  });

  // 3.1 If the app is already actively generating (e.g. after a page reload mid-flight), bypass connection steps
  const isGenerating = await page
    .getByRole('button', { name: 'Cancel Generation' })
    .isVisible()
    .catch(() => false);
  if (isGenerating) {
    console.log(
      '>>> React App is already connected and actively generating. Bypassing connection phase.'
    );
    return;
  }

  // 3.5 Dismiss Liferay Enterprise Search modal if it appears
  const modalDoneBtn = page.getByRole('button', { name: 'Done', exact: true });
  if (await modalDoneBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await modalDoneBtn.click();
    await expect(modalDoneBtn).toBeHidden({ timeout: 5000 });
  }

  // 4. Click 'Test Connection' and retry if it fails (e.g., Liferay background re-indexing returning 401)
  let connected = false;
  for (let i = 0; i < 10; i++) {
    const connectBtn = page
      .getByRole('button', {
        name: /(Test Connection & Load Data|Retry Connection)/i,
      })
      .first();

    let isBtnVisible = false;
    try {
      isBtnVisible = await connectBtn.isVisible({ timeout: 2000 });
    } catch (e) {
      console.log(
        `>>> [Attempt ${i + 1}/10] Error checking visibility: ${e.message}`
      );
    }

    if (!isBtnVisible) {
      // Check if we are already connected
      const connectedBtn = page
        .getByRole('button', { name: /^Connected$/i })
        .first();
      if (await connectedBtn.isVisible()) {
        connected = true;
        break;
      }
      console.log(
        `>>> [Attempt ${i + 1}/10] Connection button not visible (possibly loading), waiting...`
      );
      await page.waitForTimeout(2000);
      continue;
    }

    console.log(`>>> [Attempt ${i + 1}/10] Clicking Test Connection button...`);
    await connectBtn.click({ force: true });

    // Wait for the state to settle to either success (Connected) or failure (Retry Connection or Test Connection & Load Data)
    try {
      await Promise.race([
        page.waitForSelector('button:has-text("Connected")', {
          state: 'visible',
          timeout: 15000,
        }),
        page.waitForSelector('button:has-text("Retry Connection")', {
          state: 'visible',
          timeout: 15000,
        }),
        page.waitForSelector('button:has-text("Test Connection & Load Data")', {
          state: 'visible',
          timeout: 15000,
        }),
      ]);
    } catch (e) {
      console.log(
        `>>> [Attempt ${i + 1}/10] Settle wait exception: ${e.message}`
      );
    }

    const connectedBtn = page
      .getByRole('button', { name: /^Connected$/i })
      .first();
    if (await connectedBtn.isVisible()) {
      connected = true;
      break;
    }

    console.log(
      `>>> [Attempt ${i + 1}/10] Connection failed or still loading, waiting before retry...`
    );
    await page.waitForTimeout(3000);
  }

  if (!connected) {
    throw new Error('Failed to connect to Liferay after multiple attempts.');
  }

  // 4.5. Wait for the Channel dropdown to not display "No channels found"
  // Since Liferay Commerce channels may take 1-2 minutes to be created and indexed on startup.
  console.log('>>> Waiting for Channel dropdown to be populated...');
  const channelDropdown = page.locator('#channelId');
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
      const connectedBtn = page.getByRole('button', { name: /^Connected$/i });
      if (await connectedBtn.isVisible().catch(() => false)) {
        await connectedBtn.click();
      }
    }
    await page.waitForTimeout(5000);
  }

  await expect(channelDropdown).not.toContainText('No channels found', {
    timeout: 120000,
  });

  // 5. Clear any lingering workflow status from previous tests so the form isn't locked
  const clearStatusBtn = page.getByRole('button', {
    name: /Clear Workflow Status/i,
  });
  if (await clearStatusBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await clearStatusBtn.click();
  }
}
