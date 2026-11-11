#!/usr/bin/env node
'use strict';

/**
 * Checks a booted `ldm quickstart aica` project for what a user would notice
 * first. Nothing tested the install path users take (#1367), and v3.3.56 shipped
 * three defects one quickstart would have shown: tooling run at Liferay's boot
 * (#1365), and a DXP tree saying `localhost`, which broke browser sign-in
 * (#1283).
 *
 * Point it at any running project directory. The facts are gathered once by
 * `readQuickstart` and asserted by `collectProblems`, which is pure, so each
 * check has a unit test - the same split as `verify-ldm-package.cjs`.
 *
 * Usage: smoke-check-quickstart.cjs <project-dir> [--insecure]
 *
 * `--insecure` skips TLS verification. LDM's certificates come from a local CA
 * a browser trusts after `mkcert -install` but Node does not; pass the CA with
 * NODE_EXTRA_CA_CERTS instead to keep verification on.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFileSync } = require('child_process');

const SITE_ERC = 'ai-commerce-accelerator';
const MICROSERVICE_ID = 'ai-commerce-accelerator-microservice';
const DXP_ROUTES = path.join('routes', 'default', 'dxp');
const MAIN_DOMAIN_KEY = 'com.liferay.lxc.dxp.main.domain';
const LIFERAY_SCRIPTS_DIR = '/mnt/liferay/scripts';
const REQUEST_TIMEOUT_MS = 30 * 1000;

/**
 * The status of one GET, or null when there was no answer at all. A refused
 * connection and a 500 are different findings and are reported differently.
 */
function getStatus(url, { headers = {}, insecure = false } = {}) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve) => {
    const request = client.get(
      url,
      { headers, rejectUnauthorized: !insecure, timeout: REQUEST_TIMEOUT_MS },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode, error: null });
      }
    );
    request.on('timeout', () => request.destroy(new Error('timed out')));
    request.on('error', (error) =>
      resolve({ status: null, error: error.message })
    );
  });
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (_error) {
    return null;
  }
}

/**
 * What Liferay will execute at boot, read from inside the container rather than
 * from the project's directory, since the mount is what decides it (#1365).
 * Null when the container could not be asked.
 */
function listLiferayScripts(containerName) {
  try {
    const out = execFileSync(
      'docker',
      [
        'exec',
        containerName,
        'sh',
        '-c',
        `ls -1 ${LIFERAY_SCRIPTS_DIR} 2>/dev/null || true`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (_error) {
    return null;
  }
}

async function readQuickstart(projectDir, { insecure = false } = {}) {
  const meta = JSON.parse(
    fs.readFileSync(path.join(projectDir, 'meta'), 'utf8')
  );
  const scheme = String(meta.ssl).toLowerCase() === 'true' ? 'https' : 'http';
  const host = meta.host_name;
  const admin = (meta.credentials || []).find(
    (entry) => entry.type === 'admin'
  );
  const basic = admin
    ? {
        Authorization: `Basic ${Buffer.from(`${admin.email}:${admin.password}`).toString('base64')}`,
      }
    : null;

  const portalUrl = `${scheme}://${host}`;
  const [portal, microservice, site] = await Promise.all([
    getStatus(`${portalUrl}/`, { insecure }),
    getStatus(`${scheme}://${MICROSERVICE_ID}.${host}/api/v1/health`, {
      insecure,
    }),
    basic
      ? getStatus(
          `${portalUrl}/o/headless-site/v1.0/sites/by-external-reference-code/${SITE_ERC}`,
          { headers: basic, insecure }
        )
      : Promise.resolve({
          status: null,
          error: 'no admin credentials in meta',
        }),
  ]);

  return {
    host,
    portalUrl,
    portal,
    microservice,
    site,
    mainDomain: readText(path.join(projectDir, DXP_ROUTES, MAIN_DOMAIN_KEY)),
    liferayScripts: listLiferayScripts(meta.container_name),
  };
}

const answered = (result) =>
  result.status === null
    ? `no answer (${result.error})`
    : `HTTP ${result.status}`;

function collectProblems(facts) {
  const problems = [];

  if (!(facts.portal.status >= 200 && facts.portal.status < 400)) {
    problems.push(
      `Liferay at ${facts.portalUrl}/ gave ${answered(facts.portal)}.`
    );
  }

  if (facts.microservice.status !== 200) {
    problems.push(
      `The microservice health check gave ${answered(facts.microservice)}, not HTTP 200.`
    );
  }

  // The DXP tree is what every client extension builds Liferay's URL and its
  // OAuth redirect URIs from, so anything but the project's own host breaks
  // sign-in - `localhost` was #1283, a port is #1407.
  if (facts.mainDomain === null) {
    problems.push(
      `routes/default/dxp has no ${MAIN_DOMAIN_KEY}; Liferay has not published it.`
    );
  } else if (facts.mainDomain !== facts.host) {
    problems.push(
      `routes/default/dxp says the main domain is '${facts.mainDomain}', not '${facts.host}'.`
    );
  }

  if (facts.liferayScripts === null) {
    problems.push(
      `Could not list ${LIFERAY_SCRIPTS_DIR} in the Liferay container.`
    );
  } else {
    const shellScripts = facts.liferayScripts.filter((name) =>
      name.endsWith('.sh')
    );
    if (shellScripts.length) {
      problems.push(
        `Liferay runs every script in ${LIFERAY_SCRIPTS_DIR} at boot, and it holds ${shellScripts.join(', ')}.`
      );
    }
  }

  if (facts.site.status !== 200) {
    problems.push(
      `The site '${SITE_ERC}' the initializer creates gave ${answered(facts.site)}, not HTTP 200.`
    );
  }

  return problems;
}

async function main(argv) {
  const insecure = argv.includes('--insecure');
  const [projectDir] = argv.filter((arg) => !arg.startsWith('--'));

  if (!projectDir) {
    console.error(
      'Usage: smoke-check-quickstart.cjs <project-dir> [--insecure]'
    );
    process.exitCode = 1;
    return;
  }

  const facts = await readQuickstart(projectDir, { insecure });
  console.log(
    [
      `Host:          ${facts.host}`,
      `Liferay:       ${answered(facts.portal)}`,
      `Microservice:  ${answered(facts.microservice)}`,
      `Site:          ${answered(facts.site)}`,
      `DXP domain:    ${facts.mainDomain ?? '(none)'}`,
      `Boot scripts:  ${facts.liferayScripts === null ? '(unknown)' : facts.liferayScripts.join(', ') || '(none)'}`,
    ].join('\n')
  );

  const problems = collectProblems(facts);
  if (problems.length) {
    console.error(
      `\n${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`
    );
    // Measured on the first real run: without LDM's CA every HTTP check
    // fails this way, which reads as a dead stack when the stack is fine.
    if (problems.some((problem) => /certificate/i.test(problem))) {
      console.error(
        "\nThe TLS failures may be only that Node does not trust LDM's local CA. Rerun with\n" +
          '  NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"\n' +
          'or pass --insecure.'
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log('\nQuickstart looks healthy to a user.');
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { collectProblems, readQuickstart, MAIN_DOMAIN_KEY, SITE_ERC };
