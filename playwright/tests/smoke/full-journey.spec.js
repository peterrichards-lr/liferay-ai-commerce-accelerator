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
    // Liferay names the panel app's portlet with underscores -
    // `..._LXC_liferay_ai_commerce_accelerator_configuration` - so a hyphenated
    // pattern could never match the page this click correctly reaches (#1428).
    await acceleratorEntry.click();
    await expect(page).toHaveURL(/ai_commerce_accelerator_configuration/);
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

    // The app's root, which test-helper waits for too. This waited for
    // `.generator-status-card`, a class the frontend has never had (#1428).
    await expect(page.locator('.ai-commerce-dashboard')).toBeVisible({
      timeout: 15000,
    });
  });

  // The proxy serves the microservice on its own subdomain, not under the
  // portal's /o/ path, and run-e2e-ldm.sh exports that address. Degraded is a
  // pass: it is the right answer on a run with no AI credentials, which is
  // every run with ai_provider=none (#1428).
  test('microservice connectivity check', async ({ page }) => {
    const microserviceUrl =
      process.env.AICA_MICROSERVICE_URL || 'http://localhost:3001';
    const response = await page.request.get(`${microserviceUrl}/api/v1/health`);
    const body = await response.json().catch(() => null);
    const detail = `${microserviceUrl}/api/v1/health -> ${response.status()} ${JSON.stringify(body)}`;

    expect(response.ok(), detail).toBe(true);
    expect(['healthy', 'degraded'], detail).toContain(body?.status);
  });
});
