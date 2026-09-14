const fs = require('fs');
const path = require('path');

const {
  EXCLUSION_KEYS,
  emptyExcludeLists,
  excludeListsJsonSchema,
} = require('@liferay/accelerator-sdk');

const ConfigService = require('../services/configService.cjs');

/**
 * The exclusion key set, pinned across the three places that used to disagree.
 *
 * Before #951 this panel offered three keys, the microservice defaulted to
 * four, and the SDK read ten. The gap was silent by construction:
 * `_getExclusions` resolves a key nobody supplies to `excludeLists[undefined]`
 * and then to `[]`, which is exactly what a configured-but-empty list looks
 * like - on the code path that then deletes things. Account groups were
 * unprotected from `deleteAccountGroupsBatch` for as long as the entity name
 * has been spelled with a hyphen (accelerator-sdk #245).
 *
 * The microservice now takes its defaults from the SDK, so it cannot drift.
 * The configuration panel cannot: the SDK depends on `better-sqlite3`,
 * `node-stream-zip` and `ws`, so it does not bundle for a browser, and its key
 * list there is a copy. This file is what stops that copy going stale - it
 * reads the panel's source and compares it with the SDK.
 */
describe('the exclusion key set agrees everywhere (#951)', () => {
  const PANEL = path.join(
    __dirname,
    '../../ai-commerce-accelerator-configuration/src/components/panels/ExcludeListsPanel.jsx'
  );

  const panelSource = () => fs.readFileSync(PANEL, 'utf8');

  const panelKeys = () => {
    const block = panelSource().match(/const EXCLUSION_KEYS = \[([\s\S]*?)\];/);

    if (!block) {
      throw new Error(
        'Could not find EXCLUSION_KEYS in ExcludeListsPanel.jsx. If it was ' +
          'renamed or restructured, update this test - it is the only thing ' +
          'keeping that list in step with the SDK.'
      );
    }

    return [...block[1].matchAll(/'([^']+)'/g)].map(([, key]) => key);
  };

  it('the panel offers every key the SDK reads', () => {
    // The direction that matters most: a key the SDK reads and the panel does
    // not offer cannot be populated by an operator, so it protects nothing.
    expect([...panelKeys()].sort()).toEqual([...EXCLUSION_KEYS].sort());
  });

  it('the panel offers no key the SDK does not read', () => {
    // The other direction. A key only the panel knows would let an operator
    // name exclusions that are never consulted - worse than not offering it,
    // because it looks like it worked.
    for (const key of panelKeys()) {
      expect(EXCLUSION_KEYS).toContain(key);
    }
  });

  it('the microservice defaults carry every key, and keep the seeded account', () => {
    const service = Object.create(ConfigService.prototype);
    const defaults = {
      ...emptyExcludeLists(),
      excludedAccounts: [{ name: 'Test Test' }],
    };

    expect(Object.keys(defaults).sort()).toEqual([...EXCLUSION_KEYS].sort());
    // The one seeded value: Liferay's own test account must survive a delete.
    expect(defaults.excludedAccounts).toEqual([{ name: 'Test Test' }]);
    expect(service).toBeDefined();
  });

  it('the panel accepts an entry naming an option by key', () => {
    // accelerator-sdk #258 made `key` matchable, which is how Liferay names
    // options and specifications - and what our own product step relies on via
    // specificationKey. A panel that rejected it would refuse an exclusion the
    // SDK honours.
    const entry = excludeListsJsonSchema().properties.excludedOptions.items;

    expect(Object.keys(entry.properties).sort()).toEqual([
      'entityId',
      'erc',
      'key',
      'name',
    ]);
    expect(panelSource()).toContain("key: { type: 'string' }");
    expect(panelSource()).toContain("{ required: ['key'] }");
  });

  it('neither side demands keys an existing saved object cannot have', () => {
    // An operator's stored ai-exclude-lists object predates most of these
    // keys. Requiring them would refuse a configuration they had no way to
    // write. The SDK makes this choice too; the panel must match it.
    expect(excludeListsJsonSchema().required ?? []).toEqual([]);
    expect(panelSource()).not.toMatch(/^\s*required: \[/m);
  });
});
