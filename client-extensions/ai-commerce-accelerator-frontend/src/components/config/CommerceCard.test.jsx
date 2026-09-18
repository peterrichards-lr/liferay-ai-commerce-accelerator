import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  });

  /**
   * The catalog is what price lists are written into, and a catalog's currency
   * is what they are denominated in - so it is the value that decides what
   * every generated price means. The dropdown showed only the name, which is
   * how a run put euro price lists inside a dollar catalog with nothing on
   * screen saying so (#746).
   */
  describe('the catalog carries its currency', () => {
    const catalogs = [
      { id: 33941, name: 'Master', currencyCode: 'USD' },
      { id: 41002, name: 'Solara Moto', currencyCode: 'EUR' },
    ];

    const renderWith = (config) => {
      useApp.mockReturnValue({ config, setConfig: vi.fn() });

      render(
        <CommerceCard
          connected={true}
          catalogs={catalogs}
          channels={[]}
          currencies={[]}
          errors={{}}
        />
      );
    };

    it('labels every catalog option with the currency it denominates', () => {
      renderWith({ catalogId: 33941 });

      expect(screen.getByText('Master (USD)')).toBeInTheDocument();
      expect(screen.getByText('Solara Moto (EUR)')).toBeInTheDocument();
    });

    it('says which catalog the run currency came from', () => {
      renderWith({ catalogId: 41002, currencyCode: 'EUR' });

      expect(
        screen.getByText(/From the catalog Solara Moto/)
      ).toBeInTheDocument();
    });

    it('asks for a catalog rather than offering a currency to choose', () => {
      renderWith({ catalogId: null });

      expect(
        screen.getByText(/Select a catalog, or add one, to settle the currency/)
      ).toBeInTheDocument();
    });

    // The field had two writers and no owner. Making it read-only is what
    // removes the ambiguity: a different currency is chosen by creating a
    // catalog in it, which is the one place a catalog is created.
    it('shows the currency read-only rather than as a select', () => {
      renderWith({ catalogId: 41002, currencyCode: 'EUR' });

      const field = screen.getByLabelText('Currency');

      expect(field).toHaveValue('EUR');
      expect(field.tagName).toBe('INPUT');
      expect(field).toHaveAttribute('readonly');
    });

    it('names both currencies when the catalog and the channel disagree', () => {
      useApp.mockReturnValue({
        config: { catalogId: 41002, channelId: 900, currencyCode: 'EUR' },
        setConfig: vi.fn(),
      });

      render(
        <CommerceCard
          connected={true}
          catalogs={catalogs}
          channels={[{ id: 900, name: 'Web Store', currencyCode: 'USD' }]}
          currencies={[]}
          errors={{}}
        />
      );

      const warning = screen.getByText(/would price in/);

      expect(warning.textContent).toMatch(/EUR/);
      expect(warning.textContent).toMatch(/USD/);
    });

    it('says nothing when the catalog and the channel agree', () => {
      useApp.mockReturnValue({
        config: { catalogId: 41002, channelId: 900, currencyCode: 'EUR' },
        setConfig: vi.fn(),
      });

      render(
        <CommerceCard
          connected={true}
          catalogs={catalogs}
          channels={[{ id: 900, name: 'Web Store', currencyCode: 'EUR' }]}
          currencies={[]}
          errors={{}}
        />
      );

      expect(screen.queryByText(/would price in/)).not.toBeInTheDocument();
    });
  });

  /**
   * The rescue button appeared only when there were no channels and vanished
   * once there was one, even a wrong one. The dialog replaces it, and it is not
   * gated on a list being empty (#746).
   */
  describe('the setup dialog replaces Auto-Create Channel', () => {
    const renderWith = ({ catalogs = [], channels = [] } = {}) => {
      useApp.mockReturnValue({ config: {}, setConfig: vi.fn() });

      render(
        <CommerceCard
          connected={true}
          catalogs={catalogs}
          channels={channels}
          currencies={[]}
          errors={{}}
        />
      );
    };

    it('offers the dialog when a channel already exists', () => {
      renderWith({ channels: [{ id: 301, name: 'Web Store' }] });

      expect(
        screen.getByRole('button', { name: 'Add catalog or channel' })
      ).toBeEnabled();
    });

    it('no longer offers Auto-Create Channel at all', () => {
      renderWith();

      expect(screen.queryByText('Auto-Create Channel')).not.toBeInTheDocument();
    });

    it('opens the dialog on the press', async () => {
      const user = userEvent.setup();

      renderWith();

      await user.click(
        screen.getByRole('button', { name: 'Add catalog or channel' })
      );

      // Clay opens the modal on a 100ms timer, so the body arrives after the
      // press rather than with it.
      expect(
        await screen.findByText('Add a catalog or a channel')
      ).toBeInTheDocument();
    });
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
