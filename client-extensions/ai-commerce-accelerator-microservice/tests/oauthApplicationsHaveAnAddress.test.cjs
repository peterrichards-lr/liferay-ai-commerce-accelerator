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

/**
 * LDM rewrites `.serviceAddress` to `{ext_name}.{host_name}` - but **only when
 * the current value contains the substring `localhost`**
 * (`ldm_core/workspace/utils.py`). `.serviceScheme` and `homePageURL` are
 * rewritten on the same condition. It applies to
 * `oAuthApplicationUserAgent` and `oAuthApplicationHeadlessServer` blocks, and
 * rewrites both the dict keys and the `typeSettings` list form.
 *
 * The Liferay client-extension build hardcodes `localhost`, so for an
 * extension that must be reachable at the project host, that rewrite is what
 * makes it work. **The substring is a trigger, not a value.** Replacing
 * `localhost:3001` with the project host - the obvious tidy-up - silently
 * stops the rewrite firing and leaves a dead address, with nothing said.
 *
 * `client-extension-routing` already forbids hand-editing these, without
 * saying why, which is what makes the tidy-up look safe. This encodes the
 * mechanism so the edit fails here instead.
 *
 * The inverse matters too: `127.0.0.1` deliberately opts out. `cli-user-agent`
 * binds a real loopback listener for the authorization-code redirect (RFC 8252
 * s8.3), and rewriting it to a project host would break that.
 *
 * This is undocumented LDM behaviour, so it could change. That coupling is
 * deliberate: a loud failure here is better than an extension quietly
 * addressing localhost in a deployed environment.
 */
const MUST_BE_REWRITTEN = {
  'ai-commerce-accelerator-microservice':
    'fronts the microservice; must be reachable at the project host',
  'ai-commerce-accelerator-microservice-user-agent':
    'the browser reaches the microservice through the project host',
};

const MUST_NOT_BE_REWRITTEN = {
  'ai-commerce-accelerator-cli-user-agent':
    'binds a real loopback listener for the OAuth redirect (RFC 8252)',
  'ai-commerce-accelerator-cli-automation':
    'client_credentials identity with no endpoint; no host should be invented for it',
};

describe("LDM's serviceAddress rewrite is triggered where it is needed", () => {
  // The property that stops this rotting: a new OAuth application cannot be
  // added without deciding which side it is on.
  test('every OAuth application is classified', () => {
    const classified = new Set([
      ...Object.keys(MUST_BE_REWRITTEN),
      ...Object.keys(MUST_NOT_BE_REWRITTEN),
    ]);
    const declared = oauthBlocks.map(([name]) => name);
    expect([...declared].sort()).toEqual([...classified].sort());
  });

  test.each(Object.entries(MUST_BE_REWRITTEN))(
    '%s keeps the localhost trigger (%s)',
    (name) => {
      const [, block] = oauthBlocks.find(([n]) => n === name);
      expect(block['.serviceAddress']).toMatch(/localhost/);
    }
  );

  test.each(Object.entries(MUST_NOT_BE_REWRITTEN))(
    '%s stays opted out of the rewrite (%s)',
    (name) => {
      const [, block] = oauthBlocks.find(([n]) => n === name);
      expect(block['.serviceAddress']).not.toMatch(/localhost/);
    }
  );
});
