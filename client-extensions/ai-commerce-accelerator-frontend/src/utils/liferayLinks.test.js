import { describe, expect, it } from 'vitest';

import { CHANNELS_PORTLET_ID, commerceChannelsUrl } from './liferayLinks';

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
