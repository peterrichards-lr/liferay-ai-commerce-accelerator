#!/usr/bin/env node
'use strict';

/**
 * Strips the build environment out of the artifacts `ldm snapshot` captures,
 * so the published `.ldmp` describes the accelerator rather than the machine
 * that packaged it. See #563.
 */

const fs = require('fs');

/**
 * `custom_env` is captured from the running CI container and IS propagated on
 * import: `snapshot.cmd_restore` copies it into the consumer's project meta,
 * and `composer` appends it to the Liferay service environment AFTER its own
 * search settings - so a duplicated key from here is the one Docker Compose
 * resolves to. The CI harness runs `--sidecar`, which pins an Elasticsearch
 * inside the Liferay container on a consumer whose project resolved to shared
 * search, and the route pins a container hostname that resolves nowhere.
 */
const PINNED_ENV_PREFIXES = [
  'LIFERAY_ROUTES_CLIENT_EXTENSION_',
  'LIFERAY_ELASTICSEARCH_',
];

/**
 * `files/portal-ext.properties` is restored as `ldmp-portal-ext.properties`,
 * layer 2 of LDM's properties cascade. LDM rewrites the machine-specific keys
 * it owns on every compose render (jdbc, virtual hosts, web.server), but it
 * writes an Elasticsearch `operationMode` only in sidecar mode - so an
 * EMBEDDED captured from CI survives into a shared-search project, where
 * `module.framework.properties.*` outranks the OSGi config LDM wrote.
 */
const PINNED_PROPERTY_PREFIXES = [
  'module.framework.properties.com.liferay.portal.search.elasticsearch',
];

const isPinnedEnvKey = (key) =>
  PINNED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));

const isPinnedPropertyKey = (key) =>
  PINNED_PROPERTY_PREFIXES.some((prefix) => key.startsWith(prefix));

function stripPinnedEnv(customEnv) {
  const kept = {};
  const dropped = {};

  for (const [key, value] of Object.entries(customEnv || {})) {
    if (isPinnedEnvKey(key)) {
      dropped[key] = value;
    } else {
      kept[key] = value;
    }
  }

  return { customEnv: kept, dropped };
}

function stripPinnedProperties(contents) {
  const lines = contents.split('\n');
  const kept = [];
  const dropped = [];
  let droppingContinuation = false;

  for (const line of lines) {
    if (droppingContinuation) {
      droppingContinuation = line.endsWith('\\');
      continue;
    }

    const separator = line.indexOf('=');
    const key = separator === -1 ? '' : line.slice(0, separator).trim();

    if (key && isPinnedPropertyKey(key)) {
      dropped.push(key);
      droppingContinuation = line.endsWith('\\');
      continue;
    }

    kept.push(line);
  }

  return { contents: kept.join('\n'), dropped };
}

function sanitizeMeta(meta) {
  const raw = meta.custom_env;

  if (raw === undefined || raw === null || raw === '') {
    return { meta, dropped: {} };
  }

  const wasString = typeof raw === 'string';
  const parsed = wasString ? JSON.parse(raw) : raw;
  const { customEnv, dropped } = stripPinnedEnv(parsed);

  return {
    meta: {
      ...meta,
      custom_env: wasString ? JSON.stringify(customEnv) : customEnv,
    },
    dropped,
  };
}

function sanitizePropertiesFile(path) {
  if (!fs.existsSync(path)) {
    console.log(`No ${path} to sanitize.`);
    return;
  }

  const { contents, dropped } = stripPinnedProperties(
    fs.readFileSync(path, 'utf8')
  );

  for (const key of dropped) {
    console.log(`Dropping build-environment property from ${path}: ${key}`);
  }

  fs.writeFileSync(path, contents);
}

function sanitizeMetaFile(path) {
  const { meta, dropped } = sanitizeMeta(
    JSON.parse(fs.readFileSync(path, 'utf8'))
  );

  for (const [key, value] of Object.entries(dropped)) {
    console.log(`Dropping build-environment env from ${path}: ${key}=${value}`);
  }

  fs.writeFileSync(path, `${JSON.stringify(meta, null, 4)}\n`);
}

function main(argv) {
  const [mode, ...paths] = argv;

  if (!paths.length || !['properties', 'meta'].includes(mode)) {
    console.error(
      'Usage: sanitize-ldm-package.cjs <properties|meta> <file> [file...]'
    );
    process.exitCode = 1;
    return;
  }

  for (const path of paths) {
    if (mode === 'properties') {
      sanitizePropertiesFile(path);
    } else {
      sanitizeMetaFile(path);
    }
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  PINNED_ENV_PREFIXES,
  PINNED_PROPERTY_PREFIXES,
  sanitizeMeta,
  stripPinnedEnv,
  stripPinnedProperties,
};
