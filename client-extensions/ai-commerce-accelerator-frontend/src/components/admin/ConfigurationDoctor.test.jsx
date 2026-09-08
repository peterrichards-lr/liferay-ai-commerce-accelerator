import React from 'react';
import { render, screen } from '@testing-library/react';

import ConfigurationDoctor, {
  resolveConfigurationLink,
} from './ConfigurationDoctor';
import { CLIENT_EXTENSIONS_PORTLET_ID } from '../../utils/liferayLinks';

const PORTLET_ID =
  'com_liferay_client_extension_web_internal_portlet_' +
  'ClientExtensionEntryPortlet_99367122642203_' +
  'LXC_liferay_ai_commerce_accelerator_configuration';

const health = (configurationExtension) => ({
  liferay: { status: 'CONNECTED', message: '' },
  aiText: { status: 'CONFIGURED', provider: 'OPENAI' },
  aiMedia: { status: 'CONFIGURED', provider: 'INHERIT' },
  prompts: { status: 'OK', missing: [] },
  schemas: { status: 'OK', missing: [] },
  ...(configurationExtension ? { configurationExtension } : {}),
});

const resolved = {
  status: 'RESOLVED',
  message: 'Configuration screen resolved for this instance.',
  externalReferenceCode: 'LXC:liferay-ai-commerce-accelerator-configuration',
  portletId: PORTLET_ID,
};

describe('resolveConfigurationLink', () => {
  it('builds the link from the portlet id the instance reported', () => {
    const { url, label } = resolveConfigurationLink(
      resolved,
      'http://localhost:8080'
    );

    expect(url).toContain(`p_p_id=${PORTLET_ID}`);
    expect(url).toContain('#ai-config');
    expect(label).toBe('Adjust Configuration');
  });

  it('uses the portal control panel path, not a site-scoped one', () => {
    const { url } = resolveConfigurationLink(
      resolved,
      'https://acme.lfr.cloud'
    );

    expect(url).toContain(
      'https://acme.lfr.cloud/group/control_panel/manage?p_p_id='
    );
    expect(url).not.toMatch(/\/group\/(guest|global)\//);
  });

  it('falls back to the Client Extensions listing when nothing was resolved', () => {
    for (const reported of [
      undefined,
      { status: 'MODULE_UNAVAILABLE', portletId: null, message: 'No module' },
      { status: 'FORBIDDEN', portletId: null, message: 'No scope' },
      // A portlet id alongside a non-resolved status is not trusted.
      { status: 'NO_PORTLET', portletId: PORTLET_ID },
    ]) {
      const { url, label } = resolveConfigurationLink(
        reported,
        'http://localhost:8080'
      );

      expect(url).toContain(`p_p_id=${CLIENT_EXTENSIONS_PORTLET_ID}`);
      expect(label).toBe('Open Client Extensions');
    }
  });

  it('surfaces the reported reason as the fallback link title', () => {
    const { title } = resolveConfigurationLink(
      { status: 'FORBIDDEN', portletId: null, message: 'The scope is missing' },
      'http://localhost:8080'
    );

    expect(title).toBe('The scope is missing');
  });

  it('offers no link at all when the base URL is unusable', () => {
    for (const value of ['', '   ', undefined, 'not-a-url', '/relative']) {
      expect(resolveConfigurationLink(resolved, value).url).toBeNull();
    }
  });
});

describe('ConfigurationDoctor', () => {
  it('renders nothing before health has been read', () => {
    const { container } = render(
      <ConfigurationDoctor health={null} liferayUrl="http://localhost:8080" />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('links straight to the configuration screen once the id is known', () => {
    render(
      <ConfigurationDoctor
        health={health(resolved)}
        liferayUrl="http://localhost:8080"
      />
    );

    const link = screen.getByRole('link', { name: /Adjust Configuration/i });
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining(`p_p_id=${PORTLET_ID}`)
    );
  });

  it('contains no numeric Liferay id of its own', () => {
    render(
      <ConfigurationDoctor
        health={health()}
        liferayUrl="http://localhost:8080"
      />
    );

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).not.toMatch(/\d{10,}/);
  });

  it('says why the direct link is unavailable rather than offering a dead one', () => {
    render(
      <ConfigurationDoctor
        health={health({
          status: 'MODULE_UNAVAILABLE',
          portletId: null,
          message: 'The client-extension-entry module is not deployed.',
        })}
        liferayUrl="http://localhost:8080"
      />
    );

    expect(screen.getByText('Configuration Screen')).toBeInTheDocument();
    expect(
      screen.getByText(/client-extension-entry module is not deployed/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Open Client Extensions/i })
    ).toBeInTheDocument();
  });

  it('explains the missing setting rather than rendering a broken link', () => {
    render(<ConfigurationDoctor health={health(resolved)} liferayUrl="" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/Set the Liferay URL/i)).toBeInTheDocument();
  });
});
