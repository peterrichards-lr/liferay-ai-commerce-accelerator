const {
  sanitizeMeta,
  stripPinnedEnv,
  stripPinnedProperties,
} = require('../../../scripts/sanitize-ldm-package.cjs');

/**
 * Covers what the release workflow removes from the published `.ldmp` (#563).
 * The fixtures are taken verbatim from the v3.3.53 package: its `custom_env`
 * and the Elasticsearch block of its `files/portal-ext.properties`, both of
 * which start an in-container Elasticsearch on a consumer whose project
 * resolved to shared search.
 */
describe('stripPinnedEnv', () => {
  it('drops the search topology captured from the CI run', () => {
    const { customEnv, dropped } = stripPinnedEnv({
      LIFERAY_ELASTICSEARCH_PERIOD_PRODUCTION_PERIOD_MODE_PERIOD_ENABLED:
        'false',
      LIFERAY_ELASTICSEARCH_PERIOD_SIDECAR_PERIOD_ENABLED: 'true',
      LIFERAY_ELASTICSEARCH_PERIOD_OPERATION_PERIOD_MODE: 'EMBEDDED',
    });

    expect(customEnv).toEqual({});
    expect(Object.keys(dropped)).toHaveLength(3);
  });

  it('drops a client extension route pinned to a build container', () => {
    const { customEnv } = stripPinnedEnv({
      LIFERAY_ROUTES_CLIENT_EXTENSION_AI_COMMERCE_ACCELERATOR_MICROSERVICE:
        'http://aica-e2e-ai-commerce-accelerator-microservice:3001',
    });

    expect(customEnv).toEqual({});
  });

  it('keeps environment that is not machine-specific', () => {
    const { customEnv, dropped } = stripPinnedEnv({
      LIFERAY_LOG4J2_CONFIGURATION_FILE:
        '/opt/liferay/osgi/log4j/portal-log4j-ext.xml',
    });

    expect(customEnv).toEqual({
      LIFERAY_LOG4J2_CONFIGURATION_FILE:
        '/opt/liferay/osgi/log4j/portal-log4j-ext.xml',
    });
    expect(dropped).toEqual({});
  });
});

describe('stripPinnedProperties', () => {
  const elasticsearchBlock = [
    'module.framework.properties.com.liferay.portal.search.elasticsearch7.configuration.ElasticsearchConfiguration.operationMode=EMBEDDED',
    'module.framework.properties.com.liferay.portal.search.elasticsearch7.configuration.ElasticsearchConfiguration.sidecarHttpPort=9201',
    'module.framework.properties.com.liferay.portal.search.elasticsearch8.configuration.ElasticsearchConfiguration.operationMode=EMBEDDED',
    'module.framework.properties.com.liferay.portal.search.elasticsearch8.configuration.ElasticsearchConfiguration.sidecarNetworkHost=0.0.0.0',
  ].join('\n');

  it('drops every Elasticsearch framework property', () => {
    const { contents, dropped } = stripPinnedProperties(elasticsearchBlock);

    expect(contents.trim()).toBe('');
    expect(dropped).toHaveLength(4);
  });

  it('keeps the accelerator properties around them', () => {
    const { contents } = stripPinnedProperties(
      [
        'feature.flag.LPD-35443=true',
        elasticsearchBlock,
        'session.timeout=120',
      ].join('\n')
    );

    expect(contents.split('\n').filter(Boolean)).toEqual([
      'feature.flag.LPD-35443=true',
      'session.timeout=120',
    ]);
  });

  it('keeps a multi-line value whose continuation looks like a bare word', () => {
    const contents = stripPinnedProperties(
      [
        'dl.file.entry.preview.image.mime.types=image/bmp,\\',
        'image/gif,\\',
        'image/png',
        'session.timeout=120',
      ].join('\n')
    ).contents;

    expect(contents.split('\n')).toHaveLength(4);
  });

  it('drops the continuation lines of a pinned multi-line value', () => {
    const { contents } = stripPinnedProperties(
      [
        'module.framework.properties.com.liferay.portal.search.elasticsearch8.configuration.ElasticsearchConfiguration.sidecarJVMOptions=-Xms1g,\\',
        '-Xmx2g',
        'session.timeout=120',
      ].join('\n')
    );

    expect(contents.split('\n').filter(Boolean)).toEqual([
      'session.timeout=120',
    ]);
  });
});

describe('sanitizeMeta', () => {
  it('rewrites custom_env in place as the JSON string LDM wrote', () => {
    const { meta, dropped } = sanitizeMeta({
      tag: '2026.q1.7-lts',
      custom_env: JSON.stringify({
        LIFERAY_LOG4J2_CONFIGURATION_FILE:
          '/opt/liferay/osgi/log4j/portal-log4j-ext.xml',
        LIFERAY_ELASTICSEARCH_PERIOD_SIDECAR_PERIOD_ENABLED: 'true',
      }),
    });

    expect(JSON.parse(meta.custom_env)).toEqual({
      LIFERAY_LOG4J2_CONFIGURATION_FILE:
        '/opt/liferay/osgi/log4j/portal-log4j-ext.xml',
    });
    expect(meta.tag).toBe('2026.q1.7-lts');
    expect(dropped).toHaveProperty(
      'LIFERAY_ELASTICSEARCH_PERIOD_SIDECAR_PERIOD_ENABLED'
    );
  });

  it('keeps an object-shaped custom_env an object', () => {
    const { meta } = sanitizeMeta({
      custom_env: {
        LIFERAY_ELASTICSEARCH_PERIOD_OPERATION_PERIOD_MODE: 'EMBEDDED',
      },
    });

    expect(meta.custom_env).toEqual({});
  });

  it('leaves a manifest with no custom_env untouched', () => {
    const meta = { tag: '2026.q1.7-lts' };

    expect(sanitizeMeta(meta).meta).toBe(meta);
  });
});
