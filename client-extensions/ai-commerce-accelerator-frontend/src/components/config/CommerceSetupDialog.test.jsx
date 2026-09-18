import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommerceSetupDialog from './CommerceSetupDialog';

/**
 * One dialog, and one currency between the two things it creates (#746).
 *
 * The rule under test is not "there is a currency field". It is that the
 * currency has exactly one source - the catalog being created, or the catalog
 * already selected - and that with neither the dialog **refuses** rather than
 * reaching for USD. A test that only checked a channel was created with *a*
 * currency would pass whether or not that currency came from the catalog, which
 * is the defect (#1014).
 */
describe('CommerceSetupDialog', () => {
  const CATALOGS = [
    { id: 33941, name: 'Master', currencyCode: 'USD' },
    { id: 41002, name: 'Solara Moto', currencyCode: 'EUR' },
    { id: 55000, name: 'Currencyless' },
  ];

  const CURRENCIES = [
    { code: 'USD', name: 'US Dollar' },
    { code: 'EUR', name: 'Euro' },
  ];

  const SITES = [
    { id: 20125, name: 'Guest' },
    { id: 40188, name: 'Solara' },
  ];

  const LANGUAGES = [
    { id: 'en_US', name: 'English (United States)' },
    { id: 'de_DE', name: 'German (Germany)' },
  ];

  // Clay opens the modal on a 100ms timer, so nothing is in the body until it
  // fires. Waiting for the first field is what makes the dialog present.
  const open = async ({
    onClose = vi.fn(),
    onCreate = vi.fn().mockResolvedValue({ success: true }),
    ...props
  } = {}) => {
    render(
      <CommerceSetupDialog
        visible
        catalogs={CATALOGS}
        currencies={CURRENCIES}
        sites={SITES}
        selectedCatalogId={null}
        submitting={false}
        onClose={onClose}
        onCreate={onCreate}
        onLoadSiteLanguages={vi.fn().mockResolvedValue(LANGUAGES)}
        {...props}
      />
    );

    await screen.findByLabelText('Site');

    return { onClose, onCreate };
  };

  const createButton = () => screen.getByRole('button', { name: 'Create' });

  const fillCatalog = async (user, { currency = 'EUR' } = {}) => {
    await user.type(screen.getByLabelText('Catalog name'), 'Solara Moto');
    await user.selectOptions(screen.getByLabelText('Currency'), currency);
    await waitFor(() =>
      expect(
        screen.getByLabelText('Default language').querySelectorAll('option')
      ).toHaveLength(LANGUAGES.length + 1)
    );
    await user.selectOptions(
      screen.getByLabelText('Default language'),
      'en_US'
    );
  };

  it('renders nothing until it is opened', () => {
    render(<CommerceSetupDialog visible={false} />);

    expect(
      screen.queryByText('Add a catalog or a channel')
    ).not.toBeInTheDocument();
  });

  it('creates a catalog and a channel in one action, with one currency', async () => {
    const user = userEvent.setup();
    const { onCreate } = await open();

    await user.selectOptions(screen.getByLabelText('Site'), '40188');
    await fillCatalog(user);
    await user.type(screen.getByLabelText('Channel name'), 'Solara Storefront');
    await user.selectOptions(
      screen.getByLabelText('Commerce site type'),
      'B2B'
    );

    await user.click(createButton());

    expect(onCreate).toHaveBeenCalledWith({
      catalog: {
        currencyCode: 'EUR',
        defaultLanguageId: 'en_US',
        name: 'Solara Moto',
      },
      channel: {
        name: 'Solara Storefront',
        siteGroupId: '40188',
        siteType: 'B2B',
      },
    });
  });

  /**
   * The assertion that matters: the channel's currency is the catalog's, and it
   * is the catalog's *because the catalog is where it came from* - not because
   * both happen to be the same string. Choosing a catalog currency the dialog
   * did not default to is what proves the source.
   */
  it('takes the channel currency from the catalog being created', async () => {
    const user = userEvent.setup();

    await open();

    await user.selectOptions(screen.getByLabelText('Site'), '40188');
    await fillCatalog(user, { currency: 'EUR' });

    const channelCurrency = screen.getByLabelText(
      'Currency (from the catalog)'
    );

    expect(channelCurrency).toHaveValue('EUR');
    expect(channelCurrency).toHaveAttribute('readonly');
    expect(
      screen.getByText(/Taken from the catalog being created/)
    ).toBeInTheDocument();
  });

  it('takes it from the selected catalog when no catalog is created', async () => {
    const user = userEvent.setup();
    const { onCreate } = await open({ selectedCatalogId: 41002 });

    await user.click(screen.getByLabelText('Create a catalog'));
    await user.selectOptions(screen.getByLabelText('Site'), '20125');
    await user.type(screen.getByLabelText('Channel name'), 'Second Storefront');

    expect(
      screen.getByText(/Taken from the selected catalog, Solara Moto \(EUR\)/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Currency (from the catalog)')).toHaveValue(
      'EUR'
    );

    await user.click(createButton());

    expect(onCreate).toHaveBeenCalledWith({
      catalog: null,
      channel: {
        name: 'Second Storefront',
        siteGroupId: '20125',
        siteType: 'B2C',
      },
    });
  });

  it('refuses when no catalog names a currency, rather than defaulting to USD', async () => {
    const user = userEvent.setup();
    const { onCreate } = await open({ selectedCatalogId: 55000 });

    await user.click(screen.getByLabelText('Create a catalog'));
    await user.selectOptions(screen.getByLabelText('Site'), '20125');
    await user.type(screen.getByLabelText('Channel name'), 'Orphan');

    expect(createButton()).toBeDisabled();
    expect(
      screen.getByText(/No currency could be determined/)
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/USD/);

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('refuses when no catalog is selected at all', async () => {
    const user = userEvent.setup();

    await open({ selectedCatalogId: null });

    await user.click(screen.getByLabelText('Create a catalog'));
    await user.selectOptions(screen.getByLabelText('Site'), '20125');
    await user.type(screen.getByLabelText('Channel name'), 'Orphan');

    expect(createButton()).toBeDisabled();
    expect(
      screen.getByText(/No currency could be determined/)
    ).toBeInTheDocument();
  });

  it('offers a currency only where a catalog is created', async () => {
    const user = userEvent.setup();

    await open({ selectedCatalogId: 41002 });

    expect(screen.getByLabelText('Currency').tagName).toBe('SELECT');

    await user.click(screen.getByLabelText('Create a catalog'));

    // No selectable currency remains: the channel's is read-only and derived.
    expect(screen.queryByLabelText('Currency')).not.toBeInTheDocument();

    const derived = screen.getByLabelText('Currency (from the catalog)');
    expect(derived.tagName).toBe('INPUT');
    expect(derived).toHaveAttribute('readonly');
  });

  it('refuses when neither a catalog nor a channel is asked for', async () => {
    const user = userEvent.setup();

    await open();

    await user.click(screen.getByLabelText('Create a catalog'));
    await user.click(screen.getByLabelText('Create a channel'));

    expect(createButton()).toBeDisabled();
    expect(
      screen.getByText('Choose a catalog, a channel, or both.')
    ).toBeInTheDocument();
  });

  it('will not create a channel without a site', async () => {
    const user = userEvent.setup();

    await open({ selectedCatalogId: 41002 });

    await user.click(screen.getByLabelText('Create a catalog'));
    await user.type(screen.getByLabelText('Channel name'), 'Siteless');

    expect(createButton()).toBeDisabled();
    expect(screen.getByText(/Choose a site/)).toBeInTheDocument();
  });

  it('lists the chosen site’s languages, not the selected channel’s', async () => {
    const user = userEvent.setup();
    const onLoadSiteLanguages = vi.fn().mockResolvedValue(LANGUAGES);

    await open({ onLoadSiteLanguages });

    expect(
      screen.getByText('Choose a site to list its languages')
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Site'), '40188');

    await waitFor(() =>
      expect(onLoadSiteLanguages).toHaveBeenCalledWith('40188')
    );
    await waitFor(() =>
      expect(screen.getByText('English (United States)')).toBeInTheDocument()
    );
  });

  /**
   * Closing on a failed create would discard everything typed, and the operator
   * would have to retype it to find out whether it failed for the same reason.
   * Asserting on `onClose` rather than on what is still painted is what makes
   * this fail when the close is fired - the modal's chrome lingers for a
   * hundred milliseconds either way.
   */
  it('stays open when the create fails, so the entries are not lost', async () => {
    const user = userEvent.setup();
    const { onClose, onCreate } = await open({
      onCreate: vi.fn().mockResolvedValue({ success: false }),
    });

    await user.selectOptions(screen.getByLabelText('Site'), '40188');
    await fillCatalog(user);
    await user.click(screen.getByLabelText('Create a channel'));
    await user.click(createButton());

    expect(onCreate).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Add a catalog or a channel')).toBeInTheDocument();
  });

  it('closes once the create has succeeded', async () => {
    const user = userEvent.setup();
    const { onClose } = await open();

    await user.selectOptions(screen.getByLabelText('Site'), '40188');
    await fillCatalog(user);
    await user.click(screen.getByLabelText('Create a channel'));
    await user.click(createButton());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  /**
   * Turning the catalog section off leaves its currency select unmounted but
   * its value in state. Reading that value anyway would let a channel be
   * created in a currency belonging to a catalog that was never made - the
   * mismatched pair, arrived at from the other direction.
   */
  it('ignores an abandoned catalog currency once the catalog is turned off', async () => {
    const user = userEvent.setup();
    const { onCreate } = await open({ selectedCatalogId: 41002 });

    await user.selectOptions(screen.getByLabelText('Currency'), 'USD');
    await user.click(screen.getByLabelText('Create a catalog'));
    await user.selectOptions(screen.getByLabelText('Site'), '20125');
    await user.type(screen.getByLabelText('Channel name'), 'Second Storefront');

    expect(screen.getByLabelText('Currency (from the catalog)')).toHaveValue(
      'EUR'
    );

    await user.click(createButton());

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ catalog: null })
    );
  });

  /**
   * A list loaded for one site must not stand in for another's while the second
   * is in flight - the operator would pick a locale the new site does not have.
   */
  it('drops the previous site\u2019s languages the moment another is chosen', async () => {
    const user = userEvent.setup();
    let release;
    const onLoadSiteLanguages = vi
      .fn()
      .mockResolvedValueOnce(LANGUAGES)
      .mockImplementationOnce(
        () => new Promise((resolve) => (release = resolve))
      );

    await open({ onLoadSiteLanguages });

    await user.selectOptions(screen.getByLabelText('Site'), '40188');
    await screen.findByText('English (United States)');

    await user.selectOptions(screen.getByLabelText('Site'), '20125');

    expect(
      screen.queryByText('English (United States)')
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Choose a site to list its languages')
    ).toBeInTheDocument();

    release([{ id: 'fr_FR', name: 'French (France)' }]);
    await screen.findByText('French (France)');
  });
});
