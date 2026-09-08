import { render, screen } from '@testing-library/react';
import CommerceCard from './CommerceCard';
import { useApp } from '../../context/AppContext';
import notifyUser from '../../utils/notifications';

vi.mock('../../context/AppContext', () => ({
  useApp: vi.fn(),
}));

vi.mock('../../utils/notifications', () => ({
  default: vi.fn(),
}));

describe('CommerceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Languages come from the channel's site, not the channel, and a channel can
  // exist without one. The empty list used to read "No languages found", which
  // is true and says nothing about why. See #639.
  describe('an empty language list explains itself', () => {
    const renderWith = ({ channelId, channels }) => {
      useApp.mockReturnValue({
        config: { channelId, selectedLanguages: [] },
        setConfig: vi.fn(),
      });

      render(
        <CommerceCard
          channels={channels}
          connected={true}
          errors={{}}
          languages={[]}
        />
      );
    };

    it('says the channel has no site when that is why', () => {
      renderWith({
        channelId: '456',
        channels: [{ id: 456, name: 'No Site Channel' }],
      });

      expect(screen.getByText(/this channel has none/i)).toBeInTheDocument();
    });

    it('does not blame a missing site when the channel has one', () => {
      // Then an empty list is genuinely unexplained, and saying the channel has
      // no site would send the operator after a setting that is already right.
      renderWith({
        channelId: '456',
        channels: [{ id: 456, name: 'Sited Channel', siteGroupId: 789 }],
      });

      expect(screen.getByText('No languages found')).toBeInTheDocument();
    });

    it('asks for a channel first when none is selected', () => {
      renderWith({ channelId: null, channels: [] });

      expect(screen.getByText(/Select a channel first/i)).toBeInTheDocument();
    });

    it('does not guess when the selected channel is not in the list', () => {
      // Mid-refresh, the id can outlive the list. Nothing is known about the
      // channel then, so the generic message is the honest one.
      renderWith({ channelId: '999', channels: [{ id: 456, name: 'Other' }] });

      expect(screen.getByText('No languages found')).toBeInTheDocument();
    });
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

  // A selection the instance does not have used to be replaced by the first
  // entry in the list without a word, which is how a run ends up in a catalog
  // nobody chose. See #680.
  describe('auto-selection', () => {
    const catalogs = [
      { id: 102, name: 'Spare Parts' },
      { id: 205, name: 'Accessories' },
    ];
    const channels = [{ id: 301, name: 'Web Store' }];

    const renderCard = (config, handlers = {}) => {
      useApp.mockReturnValue({ config, setConfig: vi.fn() });

      return render(
        <CommerceCard
          connected={true}
          catalogs={catalogs}
          channels={channels}
          errors={{}}
          {...handlers}
        />
      );
    };

    it('defaults quietly when nothing has been selected', () => {
      const onSelectCatalog = vi.fn();

      renderCard({}, { onSelectCatalog });

      expect(onSelectCatalog).toHaveBeenCalledWith('102');
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('leaves a selection the instance has alone', () => {
      const onSelectCatalog = vi.fn();

      renderCard({ catalogId: 205, channelId: 301 }, { onSelectCatalog });

      expect(onSelectCatalog).not.toHaveBeenCalled();
      expect(notifyUser).not.toHaveBeenCalled();
    });

    it('says so when it replaces a catalog the instance does not have', () => {
      const onSelectCatalog = vi.fn();

      renderCard({ catalogId: 34205, channelId: 301 }, { onSelectCatalog });

      expect(onSelectCatalog).toHaveBeenCalledWith('102');
      expect(notifyUser).toHaveBeenCalledWith(
        expect.stringContaining('Catalog id 34205 is not on this instance'),
        'warning'
      );
      expect(notifyUser.mock.calls[0][0]).toContain(
        "Switched to 'Spare Parts' (id 102)"
      );
    });

    it('says so when it replaces a channel the instance does not have', () => {
      const onSelectChannel = vi.fn();

      renderCard({ catalogId: 102, channelId: 34907 }, { onSelectChannel });

      expect(onSelectChannel).toHaveBeenCalledWith('301');
      expect(notifyUser).toHaveBeenCalledWith(
        expect.stringContaining('Channel id 34907 is not on this instance'),
        'warning'
      );
    });
  });
});
