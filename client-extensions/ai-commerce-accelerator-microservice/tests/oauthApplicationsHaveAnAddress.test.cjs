const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

/**
 * Every OAuth application must declare an address and scheme.
 *
 * `ai-commerce-accelerator-cli-automation` declared neither and Liferay
 * refused to create it: `homePageURL` is @Deprecated and unset, so
 * `BaseConfigurationFactory.getHomePageURL` falls back to `baseURL`, and
 * `OAuth2ApplicationLocalServiceImpl._validate` requires a `http://` or
 * `https://` prefix on the result. Blank is legal; schemeless is not.
 *
 * The application was therefore never created and no routes were written for
 * it. The only sign was `OAuth2ApplicationHomePageURLSchemeException: null` in
 * Liferay's log - which this repository did not keep until #1130, so it ran
 * that way unnoticed. See #1136.
 *
 * The address is not always load-bearing: a client_credentials application
 * binds no listener. It is required anyway, because Liferay validates a URL
 * derived from it.
 */
const CX = path.resolve(__dirname, '..', 'client-extension.yaml');
const manifest = YAML.parse(fs.readFileSync(CX, 'utf8'));

const oauthBlocks = Object.entries(manifest).filter(
  ([, block]) =>
    block &&
    typeof block === 'object' &&
    typeof block.type === 'string' &&
    block.type.startsWith('oAuthApplication')
);

describe('OAuth applications declare an absolute base URL (#1136)', () => {
  test('the manifest declares some, or this guard is vacuous', () => {
    expect(oauthBlocks.length).toBeGreaterThan(0);
  });

  test.each(oauthBlocks)(
    '%s declares an address and scheme',
    (_name, block) => {
      expect(block['.serviceAddress']).toBeTruthy();
      expect(block['.serviceScheme']).toBeTruthy();
    }
  );

  test.each(oauthBlocks)('%s resolves to an absolute URL', (_name, block) => {
    const url = `${block['.serviceScheme']}://${block['.serviceAddress']}`;
    // The exact check Liferay applies before it will create the application.
    expect(url.startsWith('http://') || url.startsWith('https://')).toBe(true);
  });
});
