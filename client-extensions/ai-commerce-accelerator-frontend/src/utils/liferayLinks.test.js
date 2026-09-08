import { describe, expect, it } from 'vitest';

import {
  CHANNELS_PORTLET_ID,
  CLIENT_EXTENSIONS_PORTLET_ID,
  clientExtensionPortletUrl,
  clientExtensionsUrl,
  commerceChannelsUrl,
} from './liferayLinks';

describe('commerceChannelsUrl', () => {
  it('builds a portal-scoped URL from the configured base', () => {
    // Portal URL, not a site one - commerce channels are administered at
    // instance level, so there is no site segment to resolve.
    const url = commerceChannelsUrl('http://localhost:8080');

    expect(url).toContain('http://localhost:8080/group/control_panel/manage');
    expect(url).toContain(`p_p_id=${CHANNELS_PORTLET_ID}`);
    expect(url).not.toMatch(/\/group\/(guest|global)\//);
  });

  it('works for a remote host, not just localhost', () => {
    expect(commerceChannelsUrl('https://acme.lfr.cloud')).toContain(
      'https://acme.lfr.cloud/group/control_panel/manage'
    );
  });

  it('tolerates a trailing slash', () => {
    expect(commerceChannelsUrl('http://localhost:8080/')).toContain(
      'http://localhost:8080/group/control_panel/manage'
    );
  });

  it('returns null when there is nothing usable to build from', () => {
    // The caller renders plain text rather than a dead link.
    for (const value of [
      '',
      '   ',
      undefined,
      null,
      'not-a-url',
      '/relative',
    ]) {
      expect(commerceChannelsUrl(value)).toBeNull();
    }
  });

  it('rejects a non-http scheme', () => {
    expect(commerceChannelsUrl('ftp://example.com')).toBeNull();
    expect(commerceChannelsUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('client extension links', () => {
  const PORTLET_ID =
    'com_liferay_client_extension_web_internal_portlet_' +
    'ClientExtensionEntryPortlet_99367122642203_' +
    'LXC_liferay_ai_commerce_accelerator_configuration';

  it('builds a client extension screen from a supplied portlet id', () => {
    const url = clientExtensionPortletUrl(
      'http://localhost:8080',
      PORTLET_ID,
      '#ai-config'
    );

    expect(url).toBe(
      `http://localhost:8080/group/control_panel/manage?p_p_id=${PORTLET_ID}` +
        '&p_p_lifecycle=0&p_p_state=maximized#ai-config'
    );
  });

  it('returns null without a portlet id, so the caller falls back', () => {
    // The id embeds the company id, which only the instance can report.
    expect(clientExtensionPortletUrl('http://localhost:8080', null)).toBeNull();
    expect(clientExtensionPortletUrl('http://localhost:8080', '')).toBeNull();
  });

  it('builds the Client Extensions listing, which needs no per-instance id', () => {
    expect(clientExtensionsUrl('http://localhost:8080')).toContain(
      `p_p_id=${CLIENT_EXTENSIONS_PORTLET_ID}`
    );
  });

  it('returns null when there is nothing usable to build from', () => {
    expect(clientExtensionsUrl('')).toBeNull();
    expect(clientExtensionPortletUrl('not-a-url', PORTLET_ID)).toBeNull();
  });
});
