const fs = require('node:fs');
const path = require('node:path');

/**
 * Whether the container received its Liferay URL is observable, not inferred.
 *
 * A remote run had the microservice up and logging, and unable to reach
 * Liferay at all:
 *
 *     Liferay API request failed (get-config:LOG_MANAGEMENT_KEY), retrying 1/3
 *     Liferay URL is not configured. Please provide liferayUrl in the request
 *     or set LIFERAY_API_URL.
 *
 * "not configured", not "unreachable" - and four minutes before Liferay was
 * ready, so not a startup race either.
 *
 * The SDK resolves that URL from four sources in order
 * (accelerator-sdk/src/utils/liferayEnv.cjs): an OAuth default,
 * tryBuildColocatedLiferayUrl(), ENV.LIFERAY_API_URL, then a persisted system
 * setting. The colocated builder reads COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL and
 * COM_LIFERAY_LXC_DXP_MAIN_DOMAIN. export_target_urls sets all three.
 *
 * My first reading was that LDM_FORWARD_PREFIXES="AI_,LIFERAY_" excluded the
 * COM_LIFERAY_LXC_ pair. That is wrong: LDM forwards LXC_ and COM_LIFERAY_LXC_
 * by default, and LDM_FORWARD_PREFIXES extends that list rather than replacing
 * it. All three should already arrive. Adding the prefix would have read as a
 * fix and changed nothing.
 *
 * Which leaves a question no amount of reading settles - whether forwarding
 * reaches containers on a *remote* node; the LDM docs describe local
 * forwarding and say nothing about compute nodes. So the run prints what the
 * container actually holds, and the next run answers it.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const source = fs.readFileSync(SCRIPT, 'utf8');
const prefixes = (
  source.match(/LDM_FORWARD_PREFIXES="([^"]+)"/)?.[1] ?? ''
).split(',');

describe('the forwarding list claims nothing it does not do', () => {
  it('keeps the prefixes LDM does not already forward', () => {
    // AI_ carries the AICA provider keys. LIFERAY_ carries LIFERAY_API_URL,
    // the SDK's third source.
    expect(prefixes).toContain('AI_');
    expect(prefixes).toContain('LIFERAY_');
  });

  it('does not re-add a prefix LDM forwards by default', () => {
    // COM_LIFERAY_LXC_ and LXC_ are automatic passthrough. Listing them again
    // would look like a fix for the missing Liferay URL and do nothing - the
    // failure mode this whole sequence has been about.
    expect(prefixes).not.toContain('COM_LIFERAY_');
    expect(prefixes).not.toContain('COM_LIFERAY_LXC_');
    expect(prefixes).not.toContain('LXC_');
  });

  it('records why they are absent, so nobody re-adds them', () => {
    expect(source).toMatch(/forwards it by default/);
    expect(source).toMatch(
      /extends that list\s*\n#\s*rather than replacing it/
    );
  });
});

describe('the container says what it actually received', () => {
  const block = source.slice(
    source.indexOf('Liferay-related environment inside'),
    source.indexOf('Waiting for Liferay Client Extensions')
  );

  it('reads the environment from inside the container', () => {
    // Not what the runner exported - the two have disagreed once already, and
    // the SDK's error names a variable without saying which source it tried.
    expect(block).toMatch(/docker exec "\$MICROSERVICE_CONTAINER" env/);
  });

  it('shows all three the SDK depends on', () => {
    expect(block).toMatch(/LIFERAY_API_URL/);
    expect(block).toMatch(/COM_LIFERAY_LXC_/);
  });

  it('does not fail the run if it cannot read them', () => {
    // A diagnostic that breaks the thing it is diagnosing is worse than none.
    expect(block).toMatch(/could not read the container's environment/);
  });
});
