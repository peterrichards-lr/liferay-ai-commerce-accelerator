import { test, expect } from '@playwright/test';
import { AICA_SITE_PATHS } from '../e2e/test-helper.js';

/**
 * AI Commerce Accelerator - Full Journey Smoke Test
 *
 * This test suite verifies the core architectural "glue" between Liferay
 * and the client extensions.
 */

test.describe('AI Commerce Accelerator Foundations', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the local Liferay instance
    // Note: This requires a running server (blade server run)
    try {
      await page.goto('/');
    } catch (e) {
      test.skip(true, 'Liferay server not reachable. Skipping E2E flow.');
    }
  });

  test('can access configuration UI', async ({ page }) => {
    // Navigate to Instance Settings portlet
    await page.goto(
      '/group/control_panel/manage?p_p_id=com_liferay_configuration_admin_web_portlet_InstanceSettingsPortlet'
    );

    // Verify the accelerator section link exists and is clickable
    const acceleratorLink = page.getByRole('link', {
      name: /AI Commerce Accelerator/i,
    });
    await expect(acceleratorLink).toBeVisible({ timeout: 10000 });
    await acceleratorLink.click();
    await expect(page).toHaveURL(/ai-commerce-accelerator/);
  });

  test('frontend extension renders generator status', async ({ page }) => {
    // Direct navigation to the page containing the Frontend CX fragment
    // The generator page is on the AICA site, not Guest, and it is called
    // data-generator - the site initializer declares
    // `friendlyURL: /data-generator`. `/web/guest/ai-generator` was wrong on
    // both counts and would have failed against a perfectly healthy instance.
    //
    // The site paths come from test-helper so there is one list. #1103 fixed
    // the path there and this spec kept its own copy, which is how it stayed
    // wrong. See #1150.
    let landed = false;

    for (const sitePath of AICA_SITE_PATHS) {
      const res = await page
        .goto(`${sitePath}/data-generator`)
        .catch(() => null);

      if (res && res.status() < 400) {
        landed = true;
        break;
      }
    }

    expect(
      landed,
      `no AICA data-generator page reachable (tried ${AICA_SITE_PATHS.map((p) => `${p}/data-generator`).join(', ')})`
    ).toBe(true);

    // Verify generator status component is visible on page
    await expect(page.locator('.generator-status-card')).toBeVisible({
      timeout: 10000,
    });
  });

  test('microservice connectivity check', async ({ page }) => {
    // Check if the microservice health endpoint is reachable and UP
    const response = await page.request.get(
      '/o/ai-commerce-accelerator-microservice/api/v1/health'
    );
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('UP');
  });
});
