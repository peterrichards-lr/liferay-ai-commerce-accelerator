import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfigurationSourceCard from './ConfigurationSourceCard';
import { useApp } from '../../context/AppContext';

vi.mock('../../context/AppContext', () => ({
  useApp: vi.fn(),
}));

/**
 * The configuration source row in the setup rail (#824, #903 §2.1).
 *
 * One collapsed line by default, because ninety-nine runs in a hundred have one
 * Liferay and a second card implies a second thing to fill in.
 */
describe('ConfigurationSourceCard', () => {
  const renderWith = (config = {}) => {
    const setConfig = vi.fn();
    useApp.mockReturnValue({ config, setConfig });
    render(<ConfigurationSourceCard />);
    return setConfig;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says same as target and asks for nothing', () => {
    renderWith({ configSourceEnabled: false });

    expect(screen.getByText(/Same as target/i)).toBeTruthy();
    expect(screen.queryByLabelText('Configuration Liferay URL')).toBeNull();
  });

  it('asks for a URL, a client id and a secret once expanded', async () => {
    renderWith({ configSourceEnabled: true });

    expect(screen.getByLabelText('Configuration Liferay URL')).toBeTruthy();
    // Client id and secret, not an OAuth ERC: resolving an ERC reads Liferay's
    // routes tree, which the split topology does not have (#903's first
    // correction).
    expect(
      screen.getByLabelText('Configuration source Client ID')
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Configuration source Client Secret')
    ).toBeTruthy();
  });

  it('clears the fields when collapsed again', async () => {
    const setConfig = renderWith({
      configSourceEnabled: true,
      configSourceUrl: 'http://localhost:8080',
      configSourceClientId: 'local-id',
      configSourceClientSecret: 'local-secret',
    });

    await userEvent.click(
      screen.getByRole('button', { name: /Use the target instance/i })
    );

    // A value that still applies but is no longer on screen is exactly the
    // defect this issue is about.
    expect(setConfig).toHaveBeenCalledWith({
      configSourceEnabled: false,
      configSourceUrl: '',
      configSourceClientId: '',
      configSourceClientSecret: '',
    });
  });

  it('keeps the secret out of the DOM as plain text', () => {
    renderWith({
      configSourceEnabled: true,
      configSourceClientSecret: 'local-secret',
    });

    expect(
      screen
        .getByLabelText('Configuration source Client Secret')
        .getAttribute('type')
    ).toBe('password');
  });

  it('expands without wiping a URL already typed', async () => {
    const setConfig = renderWith({
      configSourceEnabled: false,
      configSourceUrl: 'http://localhost:8080',
    });

    await userEvent.click(
      screen.getByRole('button', { name: /Use a different instance/i })
    );

    expect(setConfig).toHaveBeenCalledWith({ configSourceEnabled: true });
  });
});
