const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

/**
 * Every panel app must name a panel category the workspace's DXP line renders.
 *
 * DXP 2026.Q4.0 renamed `control_panel.configuration` to
 * `control_panel.instance`. The old key still deployed: the bundle started,
 * Liferay logged nothing, and the AICA Configuration entry simply never
 * appeared in the Control Panel. Only the node E2E noticed (#1488).
 *
 * The keys are `PanelCategoryKeys` from `com.liferay.application.list.api.jar`
 * in the `liferay/dxp` image for each line, read on 2026-11-18. A new line in
 * `liferay.workspace.product` fails here until its keys are added, which is
 * the point: read them from that line's jar rather than assume they held.
 *
 * This lives in the microservice's suite because it is the only one that runs.
 * It reaches up to the repository root deliberately, as sharedOsgiPin does.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CX_ROOT = path.join(REPO_ROOT, 'client-extensions');

const PANEL_CATEGORY_KEYS = new Map([
  [
    'dxp-2026.q4.0',
    [
      'applications_menu',
      'applications_menu.applications',
      'commerce',
      'control_panel',
      'control_panel.apps',
      'control_panel.instance',
      'control_panel.marketplace',
      'control_panel.notifications',
      'control_panel.object',
      'control_panel.security',
      'control_panel.sites',
      'control_panel.system',
      'control_panel.users',
      'control_panel.workflow',
      'site_administration',
      'site_administration.build',
      'site_administration.content',
      'site_administration.design',
      'site_administration.members',
      'site_administration.my_sites',
      'site_administration.navigation',
      'site_administration.publishing',
      'site_administration.recycle_bin',
      'user',
      'user.my_account',
      'user.sign_out',
    ],
  ],
]);

function workspaceProduct() {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'gradle.properties'),
    'utf8'
  );

  return source.match(/^liferay\.workspace\.product=(\S+)\s*$/m)[1];
}

const panelApps = fs
  .readdirSync(CX_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .flatMap((e) => {
    const file = path.join(CX_ROOT, e.name, 'client-extension.yaml');

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(file)) return [];

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const doc = YAML.parse(fs.readFileSync(file, 'utf8')) || {};

    return Object.entries(doc)
      .filter(([, value]) => value && value.panelCategoryKey)
      .map(([id, value]) => [id, value.panelCategoryKey]);
  });

describe('panel apps name a category their DXP line renders (#1488)', () => {
  const product = workspaceProduct();

  it(`knows the panel category keys of ${product}`, () => {
    expect(
      PANEL_CATEGORY_KEYS.get(product),
      `No panel category keys recorded for ${product}. Read PanelCategoryKeys ` +
        'from com.liferay.application.list.api.jar in that line and add them.'
    ).toBeDefined();
  });

  it('finds at least one panel app to check', () => {
    expect(panelApps.length).toBeGreaterThan(0);
  });

  it.each(panelApps)('%s uses a key that exists', (_id, key) => {
    expect(PANEL_CATEGORY_KEYS.get(product) || []).toContain(key);
  });
});
