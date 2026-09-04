import { render, screen } from '@testing-library/react';
import CommerceCard from './CommerceCard';
import { useApp } from '../../context/AppContext';

vi.mock('../../context/AppContext', () => ({
  useApp: vi.fn(),
}));

describe('CommerceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders currency names as strings, not objects', () => {
    useApp.mockReturnValue({
      config: { channelId: '123' },
      setConfig: vi.fn(),
    });

    const currencies = [
      { code: 'USD', name: 'US Dollar' },
      { code: 'EUR', name: 'Euro' },
    ];

    render(
      <CommerceCard connected={true} currencies={currencies} errors={{}} />
    );

    // Verify that the names are rendered correctly in the options
    expect(screen.getByText('US Dollar (USD)')).toBeInTheDocument();
    expect(screen.getByText('Euro (EUR)')).toBeInTheDocument();

    // Explicitly check that [object Object] is NOT present in the component output
    expect(document.body.innerHTML).not.toContain('[object Object]');
  });

  it('renders catalog and channel names as strings', () => {
    useApp.mockReturnValue({
      config: {},
      setConfig: vi.fn(),
    });

    const catalogs = [{ id: 'cat1', name: 'Main Catalog' }];
    const channels = [{ id: 'ch1', name: 'Web Store' }];

    render(
      <CommerceCard
        connected={true}
        catalogs={catalogs}
        channels={channels}
        errors={{}}
      />
    );

    expect(screen.getByText('Main Catalog')).toBeInTheDocument();
    expect(screen.getByText('Web Store')).toBeInTheDocument();

    expect(document.body.innerHTML).not.toContain('[object Object]');
  });

  it('handles empty lists gracefully', () => {
    useApp.mockReturnValue({
      config: {},
      setConfig: vi.fn(),
    });

    render(
      <CommerceCard
        connected={true}
        catalogs={[]}
        channels={[]}
        currencies={[]}
        errors={{}}
      />
    );

    expect(screen.getByText('No catalogs found')).toBeInTheDocument();
    expect(screen.getByText('No channels found')).toBeInTheDocument();
    expect(screen.getByText('No currencies found')).toBeInTheDocument();
  });

  it('says what Auto-Create Channel actually produces', () => {
    // The payload sends only currencyCode, name and type: 'site' - the channel
    // type, not B2B/B2C/B2X - so the channel has no site association and no
    // commerce site type, and neither is settable through the API. Without
    // saying so, the button reads as equivalent to creating one in Liferay.
    // See #624.
    useApp.mockReturnValue({
      config: {},
      setConfig: vi.fn(),
    });

    render(
      <CommerceCard
        connected={true}
        catalogs={[]}
        channels={[]}
        currencies={[]}
        errors={{}}
      />
    );

    expect(screen.getByText('Auto-Create Channel')).toBeInTheDocument();

    const caveat = screen.getByText(/no site and no commerce site type/i);
    expect(caveat).toBeInTheDocument();
    expect(caveat.textContent).toMatch(/B2B, B2C or B2X/);
    expect(caveat.textContent).toMatch(/Commerce . Channels/);
  });

  it('links to the channels screen on the configured instance', () => {
    // Built from config.liferayUrl so it works for a remote instance as well
    // as localhost. Portal-scoped, so there is no site segment.
    useApp.mockReturnValue({
      config: { liferayUrl: 'https://acme.lfr.cloud' },
      setConfig: vi.fn(),
    });

    render(
      <CommerceCard
        connected={true}
        catalogs={[]}
        channels={[]}
        currencies={[]}
        errors={{}}
      />
    );

    const link = screen.getByRole('link', { name: /Commerce . Channels/ });
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining(
        'https://acme.lfr.cloud/group/control_panel/manage'
      )
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders plain text when there is no usable instance URL', () => {
    // A dead link is worse than none.
    useApp.mockReturnValue({
      config: { liferayUrl: '' },
      setConfig: vi.fn(),
    });

    render(
      <CommerceCard
        connected={true}
        catalogs={[]}
        channels={[]}
        currencies={[]}
        errors={{}}
      />
    );

    expect(
      screen.queryByRole('link', { name: /Commerce . Channels/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Liferay under Commerce . Channels/)
    ).toBeInTheDocument();
  });
});
