#!/usr/bin/env node
'use strict';

/**
 * The release gate for the published `.ldmp`. Every check here exists because a
 * release shipped without it: the database dump (#551), the empty
 * `client_extensions` list (#556), the missing OSGi bundle (v3.3.53), and the
 * pinned microservice route and search topology (#563). It lived as an inline
 * heredoc in `.github/workflows/package-ldmp.yml`, where the only way to run it
 * was to push a tag. See #996.
 *
 * The facts are gathered once by `readPackage` and asserted by `collectProblems`,
 * which is pure, so the gate can be exercised against any package on disk -
 * including an already published one - and each check has a unit test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * The gate looks for exactly what `sanitize-ldm-package.cjs` removes, by calling
 * the sanitiser's own functions rather than restating its prefixes. A prefix
 * added there is therefore refused here without a second edit, which is the
 * drift the duplicated list in the heredoc invited.
 */
const {
  stripPinnedEnv,
  stripPinnedProperties,
} = require('./sanitize-ldm-package.cjs');

const REQUIRED_META_KEYS = [
  'tag',
  'admin_email',
  'banner_notes',
  'credentials',
  'feature_flags',
];

const EXPECTED_HOST_NAME = 'aica.demo';
const MAX_PACKAGE_MB = 250;
const FORBIDDEN_MEMBERS = ['database.sql', 'database.gz'];
const DEFAULT_STAGED_DIR = 'bundles/osgi/modules';
const PORTAL_EXT_MEMBER = 'files/portal-ext.properties';
const CLIENT_EXTENSION_DIR = 'osgi/client-extensions/';
const OSGI_MODULE_DIR = 'osgi/modules/';

/**
 * LDM writes meta values as strings, so `"false"` has to read as false, while an
 * absent key reads as false too.
 */
const truthy = (value) =>
  value !== undefined &&
  value !== null &&
  !['false', 'none', ''].includes(String(value).toLowerCase());

/**
 * tar member names appear with or without a leading `./` depending on how the
 * archive was created; normalise rather than depend on the form.
 */
const normaliseName = (name) => (name.startsWith('./') ? name.slice(2) : name);

const basenamesUnder = (names, directory, extension) =>
  [
    ...new Set(
      names
        .map(normaliseName)
        .filter(
          (name) => name.startsWith(directory) && name.endsWith(extension)
        )
        .map((name) => name.slice(name.lastIndexOf('/') + 1))
    ),
  ].sort();

const parseCustomEnv = (meta) => {
  const raw = meta.custom_env;

  if (typeof raw === 'string') {
    return raw.trim() ? JSON.parse(raw) : {};
  }

  return raw || {};
};

const pinnedEnvKeys = (customEnv) =>
  Object.keys(stripPinnedEnv(customEnv).dropped).sort();

const pinnedPropertyKeys = (contents) =>
  [...stripPinnedProperties(contents || '').dropped].sort();

const declaredClientExtensions = (meta) =>
  String(meta.client_extensions ?? '')
    .split(',')
    .filter(Boolean);

const shippedClientExtensions = (innerNames) =>
  basenamesUnder(innerNames, CLIENT_EXTENSION_DIR, '.zip');

const packagedOsgiModules = (innerNames) =>
  basenamesUnder(innerNames, OSGI_MODULE_DIR, '.jar');

const format = (value) => JSON.stringify(value ?? null);

const formatList = (values) => `[${values.map(format).join(', ')}]`;

const withoutTrailingSlash = (directory) => directory.replace(/\/$/u, '');

/**
 * Report everything BEFORE asserting anything. A run that trips one assertion
 * should still tell us the surrounding facts - v3.3.49 died on
 * includes_volume_assets without ever printing the package size, which left us
 * unable to say whether the exclusion had partly worked. See #551.
 */
function describePackage(facts) {
  const { meta, members, sizeMb, innerNames, portalExt, stagedJars } = facts;

  const describe = (label, value) => `  ${label.padEnd(23)}: ${value}`;
  const orNone = (values) => (values.length ? values.join(', ') : 'none');

  return [
    describe('package size', `${sizeMb.toFixed(1)} MB`),
    describe('archive members', members.join(', ')),
    describe('tag', format(meta.tag)),
    describe('db_type', format(meta.db_type)),
    describe('includes_database', format(meta.includes_database)),
    describe('includes_volume_assets', format(meta.includes_volume_assets)),
    describe('host_name', format(meta.host_name)),
    describe('ssl', format(meta.ssl)),
    describe('client_extensions', format(meta.client_extensions)),
    describe(
      'enrichment keys present',
      formatList(REQUIRED_META_KEYS.filter((key) => key in meta))
    ),
    describe('pinned env', orNone(pinnedEnvKeys(parseCustomEnv(meta)))),
    describe('pinned properties', orNone(pinnedPropertyKeys(portalExt))),
    describe('osgi modules staged', orNone(stagedJars)),
    describe('osgi modules packaged', orNone(packagedOsgiModules(innerNames))),
  ];
}

function collectProblems(facts) {
  const {
    meta,
    members,
    sizeMb,
    innerNames,
    portalExt,
    stagedDir,
    stagedDirExists,
    stagedJars,
  } = facts;

  const problems = [];

  const missing = REQUIRED_META_KEYS.filter((key) => !(key in meta));
  if (missing.length) {
    problems.push(`meta is missing required keys: ${formatList(missing)}`);
  }

  if (truthy(meta.includes_database)) {
    problems.push(
      `includes_database=${format(meta.includes_database)};` +
        ' the stack was not stopped before packaging'
    );
  }

  if (truthy(meta.includes_volume_assets)) {
    problems.push(
      `includes_volume_assets=${format(meta.includes_volume_assets)};` +
        ' Liferay data/state were captured into the archive'
    );
  }

  for (const unwanted of FORBIDDEN_MEMBERS) {
    if (members.includes(unwanted)) {
      problems.push(`package contains ${unwanted}`);
    }
  }

  if (sizeMb > MAX_PACKAGE_MB) {
    problems.push(
      `package is ${sizeMb.toFixed(0)} MB; expected well under ${MAX_PACKAGE_MB} MB`
    );
  }

  if (meta.host_name !== EXPECTED_HOST_NAME) {
    problems.push(
      `host_name=${format(meta.host_name)}; expected ${format(EXPECTED_HOST_NAME)}.` +
        " The CI harness's own host has leaked into the published package"
    );
  }

  const pinnedEnv = pinnedEnvKeys(parseCustomEnv(meta));
  if (pinnedEnv.length) {
    problems.push(
      `custom_env pins ${formatList(pinnedEnv)}; these carry the build environment's` +
        ' container hostnames and search topology, and win over the settings' +
        " LDM derives for the consumer's own project"
    );
  }

  const pinnedProperties = pinnedPropertyKeys(portalExt);
  if (pinnedProperties.length) {
    problems.push(
      `${PORTAL_EXT_MEMBER} pins ${formatList(pinnedProperties)}; these force an` +
        ' in-container Elasticsearch on consumers whose project resolved to' +
        ' shared search'
    );
  }

  const declared = [...declaredClientExtensions(meta)].sort();
  const shipped = shippedClientExtensions(innerNames);
  if (formatList(declared) !== formatList(shipped)) {
    problems.push(
      `client_extensions declares ${formatList(declared)} but the archive ships` +
        ` ${formatList(shipped)}`
    );
  }

  const packagedJars = packagedOsgiModules(innerNames);
  if (!stagedDirExists) {
    // Distinguished from a mismatch: every packaged jar would otherwise be
    // reported as unexpected, blaming the package for a check that could not
    // run. The directory is populated by the Gradle deploy earlier in the job,
    // so its absence means the build changed shape, not that the package is
    // wrong.
    problems.push(
      `${stagedDir} does not exist, so ${withoutTrailingSlash(OSGI_MODULE_DIR)} cannot be verified`
    );
  } else if (formatList(stagedJars) !== formatList(packagedJars)) {
    const onlyStaged = stagedJars.filter((jar) => !packagedJars.includes(jar));
    const onlyPackaged = packagedJars.filter(
      (jar) => !stagedJars.includes(jar)
    );
    const detail = [];

    if (onlyStaged.length) {
      detail.push(`built but not shipped: ${formatList(onlyStaged)}`);
    }
    if (onlyPackaged.length) {
      detail.push(`shipped but not built: ${formatList(onlyPackaged)}`);
    }

    problems.push(
      `${withoutTrailingSlash(OSGI_MODULE_DIR)} disagrees with ${stagedDir}; ` +
        detail.join('; ')
    );
  }

  if (truthy(meta.includes_client_extensions) && !declared.length) {
    problems.push(
      'includes_client_extensions is true but client_extensions is empty'
    );
  }

  if (!truthy(meta.ssl)) {
    problems.push(
      `ssl=${format(meta.ssl)}; expected a truthy value. Without it LDM` +
        ' starts no proxy, so the Headless call fails and fragment' +
        ' overrides are skipped'
    );
  }

  return problems;
}

const listArchive = (archive) =>
  execFileSync('tar', ['tzf', archive], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);

const memberNamed = (names, wanted) =>
  names.find((name) => normaliseName(name) === wanted);

const readMember = (archive, member) =>
  execFileSync('tar', ['xzOf', archive, member], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

/**
 * The outer archive is expanded to a temporary directory rather than read
 * through a pipe: `files.tar.gz` is the bulk of a package that may legitimately
 * approach 250 MB, and buffering all of it to read one text file out of it is
 * needless.
 */
function readPackage(packagePath, { stagedDir = DEFAULT_STAGED_DIR } = {}) {
  const members = listArchive(packagePath);
  const metaMember = memberNamed(members, 'meta');
  const filesMember = memberNamed(members, 'files.tar.gz');

  if (!metaMember) {
    throw new Error(`${packagePath} has no meta member`);
  }
  if (!filesMember) {
    throw new Error(`${packagePath} has no files.tar.gz member`);
  }

  const meta = JSON.parse(readMember(packagePath, metaMember));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ldmp-verify-'));

  try {
    execFileSync('tar', ['xzf', packagePath, '-C', workspace, filesMember]);

    const inner = path.join(workspace, normaliseName(filesMember));
    const innerNames = listArchive(inner);
    const portalExtMember = memberNamed(innerNames, PORTAL_EXT_MEMBER);
    const stagedDirExists = fs.existsSync(stagedDir);

    return {
      meta,
      members: members.map(normaliseName),
      sizeMb: fs.statSync(packagePath).size / 1024 / 1024,
      innerNames,
      portalExt: portalExtMember ? readMember(inner, portalExtMember) : '',
      stagedDir,
      stagedDirExists,
      stagedJars: stagedDirExists
        ? fs
            .readdirSync(stagedDir)
            .filter((name) => name.endsWith('.jar'))
            .sort()
        : [],
    };
  } finally {
    fs.rmSync(workspace, { force: true, recursive: true });
  }
}

function main(argv) {
  const positional = [];
  let stagedDir = DEFAULT_STAGED_DIR;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--staged-dir') {
      index += 1;
      stagedDir = argv[index];
    } else {
      positional.push(argv[index]);
    }
  }

  const [packagePath] = positional;

  if (!packagePath || !stagedDir) {
    console.error(
      'Usage: verify-ldm-package.cjs <package.ldmp> [--staged-dir <dir>]'
    );
    process.exitCode = 1;
    return;
  }

  const facts = readPackage(packagePath, { stagedDir });

  for (const line of describePackage(facts)) {
    console.log(line);
  }

  const problems = collectProblems(facts);

  if (problems.length) {
    console.error(
      `Refusing to publish. ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`
    );
    process.exitCode = 1;
    return;
  }

  console.log('Package verified; safe to publish.');
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  EXPECTED_HOST_NAME,
  MAX_PACKAGE_MB,
  REQUIRED_META_KEYS,
  collectProblems,
  describePackage,
  parseCustomEnv,
  pinnedEnvKeys,
  pinnedPropertyKeys,
  readPackage,
  truthy,
};
