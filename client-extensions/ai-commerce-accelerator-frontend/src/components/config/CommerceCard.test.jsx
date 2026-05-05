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
      <CommerceCard
        connected={true}
        currencies={currencies}
        errors={{}}
      />
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
});
