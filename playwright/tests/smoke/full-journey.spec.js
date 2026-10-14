import { test, expect } from '../../fixtures/diagnostics.js';
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

    // The entry is a Control Panel PANEL APP, not an Instance Settings
    // category, so it has never appeared in the Instance Settings body. From
    // its own definition:
    //
    //     panelCategoryKey: control_panel.configuration
    //     panelAppOrder: 700
    //
    // This asserted `getByRole('link')` against Instance Settings until #1285.
    // Run 38410417089's page snapshot has 67 link roles there - Commerce,
    // Platform, Security, Content and Data, Other - and no AICA among them,
    // while the product menu carries
    // `menuitem "Liferay AI Commerce Accelerator Configuration"`. The panel
    // app registration (c6c84f09, 2026-05-01) predates this assertion
    // (2a7c3b17, 2026-08-14) by three months, so the spec never passed and
    // the DXP version is a red herring.
    //
    // The menu is expanded on this page in practice; opening it is guarded
    // rather than assumed, because a collapsed menu would otherwise fail as
    // "element not found" and read as a missing entry.
    const openProductMenu = page.getByRole('tab', {
      name: 'Open Product Menu',
    });
    if (await openProductMenu.isVisible().catch(() => false)) {
      await openProductMenu.click();
    }

    const acceleratorEntry = page.getByRole('menuitem', {
      name: /AI Commerce Accelerator/i,
    });
    await expect(acceleratorEntry).toBeVisible({ timeout: 10000 });

    // The click-through is the point: the test is that the entry is reachable
    // and leads somewhere, not that a string is present.
    await acceleratorEntry.click();
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
