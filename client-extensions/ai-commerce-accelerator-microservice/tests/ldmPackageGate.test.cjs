const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  collectProblems,
  describePackage,
  parseCustomEnv,
  pinnedEnvKeys,
  pinnedPropertyKeys,
  readPackage,
  truthy,
} = require('../../../scripts/verify-ldm-package.cjs');

/**
 * The release gate that decides whether a `.ldmp` is fit to publish (#996).
 * Every check it makes was added because a release shipped without it, so each
 * one is exercised here on an otherwise sound package: the assertion is that
 * exactly one problem is raised, which is what fails if a check is weakened
 * into never firing.
 */
const soundPackage = () => ({
  meta: {
    admin_email: 'test@liferay.com',
    banner_notes: ['🚀 Welcome to the Liferay AI Commerce Accelerator!'],
    client_extensions:
      'ai-commerce-accelerator-frontend.zip,ai-commerce-accelerator-configuration.zip',
    credentials: [{ email: 'test@liferay.com', type: 'admin' }],
    custom_env: JSON.stringify({
      LIFERAY_LOG4J2_CONFIGURATION_FILE:
        '/opt/liferay/osgi/log4j/portal-log4j-ext.xml',
    }),
    db_type: 'postgresql',
    feature_flags: { 'LPS-168340': true, 'LPS-178642': true },
    host_name: 'aica.demo',
    includes_client_extensions: 'true',
    includes_database: 'false',
    includes_volume_assets: 'false',
    ssl: 'true',
    tag: '2026.q1.7-lts',
  },
  members: ['meta', 'files.tar.gz'],
  sizeMb: 182.4,
  innerNames: [
    './files/portal-ext.properties',
    './osgi/client-extensions/ai-commerce-accelerator-configuration.zip',
    './osgi/client-extensions/ai-commerce-accelerator-frontend.zip',
    './osgi/modules/com.liferay.commerce.site.type.api.jar',
    './osgi/modules/com.liferay.commerce.site.type.impl.jar',
  ],
  portalExt: 'feature.flag.LPD-35443=true\nsession.timeout=120\n',
  stagedDir: 'bundles/osgi/modules',
  stagedDirExists: true,
  stagedJars: [
    'com.liferay.commerce.site.type.api.jar',
    'com.liferay.commerce.site.type.impl.jar',
  ],
});

const problemsAfter = (mutate) => {
  const facts = soundPackage();
  mutate(facts);
  return collectProblems(facts);
};

const onlyProblem = (mutate) => {
  const problems = problemsAfter(mutate);
  expect(problems).toHaveLength(1);
  return problems[0];
};

describe('collectProblems', () => {
  it('raises nothing for a package built the way the workflow intends', () => {
    expect(collectProblems(soundPackage())).toEqual([]);
  });

  it('refuses a meta that lost its enrichment keys (#556)', () => {
    const problem = onlyProblem((facts) => {
      delete facts.meta.banner_notes;
      delete facts.meta.credentials;
    });

    expect(problem).toContain('missing required keys');
    expect(problem).toContain('banner_notes');
    expect(problem).toContain('credentials');
  });

  it('refuses a package whose meta claims a bundled database (#551)', () => {
    expect(
      onlyProblem((facts) => {
        facts.meta.includes_database = 'true';
      })
    ).toContain('the stack was not stopped before packaging');
  });

  it('refuses a package that captured Liferay data and state (#551)', () => {
    expect(
      onlyProblem((facts) => {
        facts.meta.includes_volume_assets = 'true';
      })
    ).toContain('Liferay data/state were captured into the archive');
  });

  it.each(['database.sql', 'database.gz'])(
    'refuses a package carrying %s as an archive member (#551)',
    (dump) => {
      expect(
        onlyProblem((facts) => {
          facts.members.push(dump);
        })
      ).toBe(`package contains ${dump}`);
    }
  );

  it('refuses a package that has grown past the size ceiling (#551)', () => {
    expect(
      onlyProblem((facts) => {
        facts.sizeMb = 980.7;
      })
    ).toContain('package is 981 MB');
  });

  it('accepts a package sitting exactly on the size ceiling', () => {
    expect(
      problemsAfter((facts) => {
        facts.sizeMb = 250;
      })
    ).toEqual([]);
  });

  it("refuses the CI harness's own host name (#556)", () => {
    expect(
      onlyProblem((facts) => {
        facts.meta.host_name = 'aica-e2e.demo';
      })
    ).toContain('has leaked into the published package');
  });

  it('refuses a client extension route pinned to a build container (#563)', () => {
    const problem = onlyProblem((facts) => {
      facts.meta.custom_env = JSON.stringify({
        LIFERAY_ROUTES_CLIENT_EXTENSION_AI_COMMERCE_ACCELERATOR_MICROSERVICE:
          'http://aica-e2e-ai-commerce-accelerator-microservice:3001',
      });
    });

    expect(problem).toContain('custom_env pins');
    expect(problem).toContain(
      'LIFERAY_ROUTES_CLIENT_EXTENSION_AI_COMMERCE_ACCELERATOR_MICROSERVICE'
    );
  });

  it("refuses the build environment's search topology in custom_env (#563)", () => {
    const problem = onlyProblem((facts) => {
      facts.meta.custom_env = JSON.stringify({
        LIFERAY_ELASTICSEARCH_PERIOD_OPERATION_PERIOD_MODE: 'EMBEDDED',
        LIFERAY_ELASTICSEARCH_PERIOD_SIDECAR_PERIOD_ENABLED: 'true',
      });
    });

    expect(problem).toContain('custom_env pins');
    expect(problem).toContain(
      'LIFERAY_ELASTICSEARCH_PERIOD_SIDECAR_PERIOD_ENABLED'
    );
  });

  it('reads an object-shaped custom_env as well as the JSON string LDM writes', () => {
    expect(
      onlyProblem((facts) => {
        facts.meta.custom_env = {
          LIFERAY_ELASTICSEARCH_PERIOD_OPERATION_PERIOD_MODE: 'EMBEDDED',
        };
      })
    ).toContain('custom_env pins');
  });

  it('refuses an Elasticsearch operationMode in portal-ext.properties (#563)', () => {
    const problem = onlyProblem((facts) => {
      facts.portalExt = [
        'feature.flag.LPD-35443=true',
        'module.framework.properties.com.liferay.portal.search.elasticsearch8.configuration.ElasticsearchConfiguration.operationMode=EMBEDDED',
      ].join('\n');
    });

    expect(problem).toContain('files/portal-ext.properties pins');
    expect(problem).toContain('in-container Elasticsearch');
  });

  it('refuses a manifest that declares an extension the archive does not ship (#556)', () => {
    const problem = onlyProblem((facts) => {
      facts.meta.client_extensions += ',ai-commerce-accelerator-batch.zip';
    });

    expect(problem).toContain('client_extensions declares');
    expect(problem).toContain('ai-commerce-accelerator-batch.zip');
  });

  it('refuses an archive that ships an extension the manifest omits (#556)', () => {
    expect(
      onlyProblem((facts) => {
        facts.innerNames.push('osgi/client-extensions/stowaway.zip');
      })
    ).toContain('but the archive ships');
  });

  it('compares extensions by name, not by the order the manifest lists them', () => {
    expect(
      problemsAfter((facts) => {
        facts.meta.client_extensions =
          'ai-commerce-accelerator-configuration.zip,ai-commerce-accelerator-frontend.zip';
      })
    ).toEqual([]);
  });

  it('refuses to verify osgi/modules when the build staged nothing', () => {
    const problem = onlyProblem((facts) => {
      facts.stagedDirExists = false;
      facts.stagedJars = [];
    });

    expect(problem).toBe(
      'bundles/osgi/modules does not exist, so osgi/modules cannot be verified'
    );
  });

  it('refuses a package missing a bundle the build produced (v3.3.53)', () => {
    const problem = onlyProblem((facts) => {
      facts.innerNames = facts.innerNames.filter(
        (name) => !name.endsWith('com.liferay.commerce.site.type.impl.jar')
      );
    });

    expect(problem).toContain(
      'osgi/modules disagrees with bundles/osgi/modules'
    );
    expect(problem).toContain(
      'built but not shipped: ["com.liferay.commerce.site.type.impl.jar"]'
    );
  });

  it('refuses a package shipping a bundle the build never produced', () => {
    const problem = onlyProblem((facts) => {
      facts.innerNames.push('osgi/modules/com.example.stale.jar');
    });

    expect(problem).toContain(
      'shipped but not built: ["com.example.stale.jar"]'
    );
  });

  it('refuses includes_client_extensions with an empty list (#556)', () => {
    const problem = onlyProblem((facts) => {
      facts.meta.client_extensions = '';
      facts.innerNames = facts.innerNames.filter(
        (name) => !name.includes('/client-extensions/')
      );
    });

    expect(problem).toBe(
      'includes_client_extensions is true but client_extensions is empty'
    );
  });

  it('refuses a package published with ssl off', () => {
    expect(
      onlyProblem((facts) => {
        facts.meta.ssl = 'false';
      })
    ).toContain('Without it LDM starts no proxy');
  });

  it('reports every problem rather than stopping at the first', () => {
    const problems = problemsAfter((facts) => {
      facts.meta.includes_database = 'true';
      facts.meta.host_name = 'aica-e2e.demo';
      facts.meta.ssl = 'false';
    });

    expect(problems).toHaveLength(3);
  });
});

describe('truthy', () => {
  it.each([
    ['true', true],
    ['True', true],
    [true, true],
    ['1', true],
    ['false', false],
    ['False', false],
    [false, false],
    ['none', false],
    ['', false],
    [undefined, false],
    [null, false],
  ])('reads %p as %p', (value, expected) => {
    expect(truthy(value)).toBe(expected);
  });
});

describe('parseCustomEnv', () => {
  it('treats an empty custom_env string as no environment at all', () => {
    expect(parseCustomEnv({ custom_env: '   ' })).toEqual({});
  });

  it('treats an absent custom_env as no environment at all', () => {
    expect(parseCustomEnv({})).toEqual({});
  });
});

describe('pinned key detection', () => {
  it('follows the sanitiser rather than a second copy of its prefixes', () => {
    expect(
      pinnedEnvKeys({
        LIFERAY_ELASTICSEARCH_PERIOD_SIDECAR_PERIOD_ENABLED: 'true',
        LIFERAY_JVM_OPTS: '-Xmx2g',
        LIFERAY_ROUTES_CLIENT_EXTENSION_MICROSERVICE: 'http://build-host:3001',
      })
    ).toEqual([
      'LIFERAY_ELASTICSEARCH_PERIOD_SIDECAR_PERIOD_ENABLED',
      'LIFERAY_ROUTES_CLIENT_EXTENSION_MICROSERVICE',
    ]);
  });

  it('ignores a portal-ext.properties with nothing pinned in it', () => {
    expect(pinnedPropertyKeys('session.timeout=120\n')).toEqual([]);
    expect(pinnedPropertyKeys('')).toEqual([]);
  });
});

describe('describePackage', () => {
  it('reports the size and the members of a package it will go on to refuse (#551)', () => {
    const facts = soundPackage();
    facts.sizeMb = 980.7;
    facts.meta.includes_volume_assets = 'true';

    const report = describePackage(facts).join('\n');

    expect(report).toContain('package size           : 980.7 MB');
    expect(report).toContain('includes_volume_assets : "true"');
    expect(report).toContain('archive members        : meta, files.tar.gz');
  });

  it('says "none" rather than nothing when a list is empty', () => {
    const facts = soundPackage();

    expect(describePackage(facts).join('\n')).toContain(
      'pinned env             : none'
    );
  });
});

/**
 * The point of moving the gate out of the workflow is that it can be run
 * against a `.ldmp` on disk, so the archive reading is exercised on a real
 * nested tar rather than mocked. The member names are written with the `./`
 * prefix LDM's own archives carry.
 */
describe('readPackage', () => {
  let workspace;

  const writePackage = (meta, { portalExt = 'session.timeout=120\n' } = {}) => {
    const build = path.join(workspace, 'build');
    const inner = path.join(build, 'inner');

    fs.mkdirSync(path.join(inner, 'osgi/client-extensions'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(inner, 'osgi/modules'), { recursive: true });
    fs.mkdirSync(path.join(inner, 'files'), { recursive: true });
    fs.writeFileSync(
      path.join(inner, 'osgi/client-extensions/frontend.zip'),
      'zip'
    );
    fs.writeFileSync(path.join(inner, 'osgi/modules/site-type.jar'), 'jar');
    fs.writeFileSync(
      path.join(inner, 'files/portal-ext.properties'),
      portalExt
    );

    execFileSync('tar', [
      'czf',
      path.join(build, 'files.tar.gz'),
      '-C',
      inner,
      './osgi',
      './files',
    ]);
    fs.writeFileSync(path.join(build, 'meta'), JSON.stringify(meta));

    const packagePath = path.join(workspace, 'accelerator.ldmp');
    execFileSync('tar', [
      'czf',
      packagePath,
      '-C',
      build,
      'meta',
      'files.tar.gz',
    ]);

    return packagePath;
  };

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ldmp-gate-test-'));
  });

  afterEach(() => {
    fs.rmSync(workspace, { force: true, recursive: true });
  });

  it('reads the meta, both member lists and portal-ext.properties out of a package', () => {
    const packagePath = writePackage(
      { host_name: 'aica.demo', tag: '2026.q1.7-lts' },
      { portalExt: 'session.timeout=120\n' }
    );
    const staged = path.join(workspace, 'staged');
    fs.mkdirSync(staged);
    fs.writeFileSync(path.join(staged, 'site-type.jar'), 'jar');

    const facts = readPackage(packagePath, { stagedDir: staged });

    expect(facts.meta.tag).toBe('2026.q1.7-lts');
    expect(facts.members.sort()).toEqual(['files.tar.gz', 'meta']);
    expect(facts.innerNames).toContain('./osgi/modules/site-type.jar');
    expect(facts.portalExt).toBe('session.timeout=120\n');
    expect(facts.stagedDirExists).toBe(true);
    expect(facts.stagedJars).toEqual(['site-type.jar']);
    expect(facts.sizeMb).toBeGreaterThan(0);
  });

  it('records an absent staged directory rather than failing to read it', () => {
    const packagePath = writePackage({ tag: '2026.q1.7-lts' });

    const facts = readPackage(packagePath, {
      stagedDir: path.join(workspace, 'never-built'),
    });

    expect(facts.stagedDirExists).toBe(false);
    expect(facts.stagedJars).toEqual([]);
    expect(collectProblems(facts)).toContainEqual(
      expect.stringContaining('cannot be verified')
    );
  });

  it('carries a pinned package through to the problems that refuse it (#563)', () => {
    const packagePath = writePackage(
      {
        admin_email: 'test@liferay.com',
        banner_notes: [],
        client_extensions: 'frontend.zip',
        credentials: [],
        custom_env: JSON.stringify({
          LIFERAY_ELASTICSEARCH_PERIOD_SIDECAR_PERIOD_ENABLED: 'true',
        }),
        feature_flags: {},
        host_name: 'aica.demo',
        ssl: 'true',
        tag: '2026.q1.7-lts',
      },
      {
        portalExt:
          'module.framework.properties.com.liferay.portal.search.elasticsearch8.configuration.ElasticsearchConfiguration.operationMode=EMBEDDED\n',
      }
    );
    const staged = path.join(workspace, 'staged');
    fs.mkdirSync(staged);
    fs.writeFileSync(path.join(staged, 'site-type.jar'), 'jar');

    const problems = collectProblems(
      readPackage(packagePath, { stagedDir: staged })
    );

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('custom_env pins');
    expect(problems[1]).toContain('files/portal-ext.properties pins');
  });
});
