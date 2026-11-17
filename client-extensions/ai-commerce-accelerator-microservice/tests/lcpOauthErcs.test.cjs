const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const { APP_ERCS } = require('../utils/constants.cjs');

/**
 * The microservice names the OAuth applications it resolves (#1450).
 *
 * config-node's `lxcConfig.oauthApplication(erc)` resolves only an ERC listed
 * in `liferay.oauth.application.external.reference.codes`, and neither DXP nor
 * LDM writes that key into the routes tree: the extension supplies it, as
 * `LIFERAY_OAUTH_APPLICATION_EXTERNAL_REFERENCE_CODES` in LCP.json's `env`.
 * Without it the lookup throws, and only the SDK's direct-key fallback kept
 * the microservice authenticating.
 */
const CX_DIR = path.resolve(__dirname, '..');

function listedCodes() {
  const lcp = JSON.parse(
    fs.readFileSync(path.join(CX_DIR, 'LCP.json'), 'utf8')
  );

  return String(
    lcp.env?.LIFERAY_OAUTH_APPLICATION_EXTERNAL_REFERENCE_CODES || ''
  )
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean);
}

function oauthApplicationsDeclared() {
  const yaml = YAML.parse(
    fs.readFileSync(path.join(CX_DIR, 'client-extension.yaml'), 'utf8')
  );

  return Object.entries(yaml)
    .filter(([_, value]) =>
      String(value?.type || '').startsWith('oAuthApplication')
    )
    .map(([erc]) => erc);
}

describe('LCP.json names the OAuth applications the microservice resolves', () => {
  test('includes its own headless server application', () => {
    expect(listedCodes()).toContain(
      APP_ERCS.OAUTH_SERVER_EXTERNAL_REFERENCE_CODE
    );
  });

  test('names only applications this extension declares', () => {
    const declared = oauthApplicationsDeclared();

    for (const code of listedCodes()) {
      expect(declared, `${code} is not declared`).toContain(code);
    }
  });
});
