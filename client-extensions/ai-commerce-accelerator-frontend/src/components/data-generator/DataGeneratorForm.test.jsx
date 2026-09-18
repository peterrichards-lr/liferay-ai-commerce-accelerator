import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DataGeneratorForm from './DataGeneratorForm';

const initialGenerationConfig = {
  productCount: 10,
  accountCount: 10,
  orderCount: 50,
  categories: ['Electronics'],
  generatePriceLists: true,
  generateBulkPricing: true,
  generateTierPricing: true,
  imageMode: 'placeholder',
  imageWidth: 1024,
  imageHeight: 1024,
  imageQuality: 'standard',
  imageStyle: 'photographic',
  imageRatio: 100,
  customImageFile: null,
  generateSpecifications: true,
  generateSkuVariants: true,
  pdfMode: 'placeholder',
  pdfRatio: 100,
  demoMode: true,
  inventoryMin: 0,
  inventoryMax: 1000,
  inventoryAssignmentRatio: 100,
  createWarehouses: true,
  warehouseCount: 5,
  customPDFFile: null,
};

describe('DataGeneratorForm', () => {
  const mockProps = {
    generationConfig: initialGenerationConfig,
    setGenerationConfig: vi.fn(),
    onGenerate: vi.fn(),
    onResetSettings: vi.fn(),
    disabled: false,
    isSubmitDisabled: false,
    disabledReason: '',
    isGenerating: false,
    forceDemoMode: false,
    aiKeyAvailable: true,
    validationErrors: {},
    availableCategories: ['Electronics', 'Clothing'],
    generationCompleted: false,
    onExport: vi.fn(),
    onImport: vi.fn(),
    liferayConnected: true,
  };

  it('renders correctly with initial config', () => {
    render(<DataGeneratorForm {...mockProps} />);

    expect(screen.getByLabelText(/^Products$/i)).toHaveValue(10);
    expect(screen.getByLabelText(/^Accounts$/i)).toHaveValue(10);
    expect(screen.getByLabelText(/^Account Type$/i)).toHaveValue('business');
    expect(screen.getByLabelText(/^Orders$/i)).toHaveValue(50);
    expect(screen.getByText(/Start Demo Generation/i)).toBeInTheDocument();
  });

  it('updates product count on change', () => {
    render(<DataGeneratorForm {...mockProps} />);

    const productInput = screen.getByLabelText(/^Products$/i);
    fireEvent.change(productInput, { target: { value: '20' } });

    expect(mockProps.setGenerationConfig).toHaveBeenCalled();
  });

  it('shows cost estimation when not in demo mode', () => {
    const liveProps = {
      ...mockProps,
      generationConfig: { ...initialGenerationConfig, demoMode: false },
    };
    render(<DataGeneratorForm {...liveProps} />);

    expect(screen.getByText(/Estimated Generation Cost/i)).toBeInTheDocument();
    // 10 products + 10 accounts + 50 orders = 70 entities * 0.002 = $0.14
    expect(screen.getAllByText(/\$0\.14/)[0]).toBeInTheDocument();
  });

  it('triggers onGenerate on form submission', () => {
    render(<DataGeneratorForm {...mockProps} />);

    const submitBtn = screen.getByText(/Start Demo Generation/i);
    fireEvent.click(submitBtn);

    expect(mockProps.onGenerate).toHaveBeenCalledWith(
      expect.objectContaining(initialGenerationConfig)
    );
  });

  describe('sections follow the volumes they configure (#677)', () => {
    const renderWith = (overrides) =>
      render(
        <DataGeneratorForm
          {...mockProps}
          generationConfig={{ ...initialGenerationConfig, ...overrides }}
        />
      );

    it.each([
      ['Products', 'productCount', 'Product Enrichment & Data'],
      ['Accounts', 'accountCount', 'Account Type'],
      ['Orders', 'orderCount', 'Order History Spread'],
    ])(
      'renders %s only while its volume is above zero',
      (legend, countField, fieldLabel) => {
        const { unmount } = renderWith({ [countField]: 5 });

        expect(screen.getByRole('group', { name: legend })).toBeInTheDocument();
        expect(screen.getByText(fieldLabel)).toBeInTheDocument();
        unmount();

        renderWith({ [countField]: 0 });

        expect(
          screen.queryByRole('group', { name: legend })
        ).not.toBeInTheDocument();
        expect(screen.queryByText(fieldLabel)).not.toBeInTheDocument();
      }
    );

    it.each(['Products', 'Accounts', 'Orders'])(
      'keeps the %s volume input itself on screen at zero',
      (label) => {
        renderWith({ accountCount: 0, orderCount: 0, productCount: 0 });

        expect(screen.getByLabelText(new RegExp(`^${label}$`))).toHaveValue(0);
      }
    );

    it('keeps the categories selector for products or accounts alone', () => {
      const { unmount } = renderWith({ accountCount: 0, productCount: 5 });
      expect(
        screen.getByRole('group', { name: 'Target Categories' })
      ).toBeInTheDocument();
      unmount();

      const second = renderWith({ accountCount: 5, productCount: 0 });
      expect(
        screen.getByRole('group', { name: 'Target Categories' })
      ).toBeInTheDocument();
      second.unmount();

      renderWith({ accountCount: 0, productCount: 0 });
      expect(
        screen.queryByRole('group', { name: 'Target Categories' })
      ).not.toBeInTheDocument();
    });

    it('asks for an order account type only when the run creates no accounts', () => {
      const { unmount } = renderWith({ accountCount: 0, orderCount: 5 });
      expect(screen.getByLabelText('Order Account Type')).toBeInTheDocument();
      unmount();

      renderWith({ accountCount: 5, orderCount: 5 });
      expect(
        screen.queryByLabelText('Order Account Type')
      ).not.toBeInTheDocument();
    });
  });

  describe('a hidden section is left out of the run (#677)', () => {
    const submit = (overrides) => {
      const onGenerate = vi.fn();
      const { unmount } = render(
        <DataGeneratorForm
          {...mockProps}
          generationConfig={{
            ...initialGenerationConfig,
            accountType: 'business',
            orderDateRangeDays: 365,
            ...overrides,
          }}
          onGenerate={onGenerate}
        />
      );
      fireEvent.click(screen.getByText(/Start Demo Generation/i));
      unmount();

      return onGenerate.mock.calls[0][0];
    };

    it('submits the product settings only when products are on screen', () => {
      expect(submit({ productCount: 5 }).createWarehouses).toBe(true);
      expect(submit({ productCount: 0 }).createWarehouses).toBeUndefined();
    });

    it('submits the account settings only when accounts are on screen', () => {
      expect(submit({ accountCount: 5 }).accountType).toBe('business');
      expect(submit({ accountCount: 0 }).accountType).toBeUndefined();
    });

    it('submits the order settings only when orders are on screen', () => {
      expect(submit({ orderCount: 5 }).orderDateRangeDays).toBe(365);
      expect(submit({ orderCount: 0 }).orderDateRangeDays).toBeUndefined();
    });

    it('still submits the volumes a hidden section was hidden by', () => {
      const config = submit({
        accountCount: 0,
        orderCount: 0,
        productCount: 0,
      });

      expect(config).toMatchObject({
        accountCount: 0,
        orderCount: 0,
        productCount: 0,
      });
    });
  });

  it('holds a hidden section in state so its volume can be restored (#677)', () => {
    const setGenerationConfig = vi.fn();
    const hidden = {
      ...initialGenerationConfig,
      orderCount: 0,
      orderDateRangeDays: 365,
    };

    const { rerender } = render(
      <DataGeneratorForm
        {...mockProps}
        generationConfig={hidden}
        setGenerationConfig={setGenerationConfig}
      />
    );

    expect(
      screen.queryByLabelText('Order History Spread')
    ).not.toBeInTheDocument();
    expect(setGenerationConfig).not.toHaveBeenCalled();

    rerender(
      <DataGeneratorForm
        {...mockProps}
        generationConfig={{ ...hidden, orderCount: 5 }}
        setGenerationConfig={setGenerationConfig}
      />
    );

    expect(screen.getByLabelText('Order History Spread')).toHaveValue(365);
  });

  it('disables submit button and shows loading state when generating', () => {
    const generatingProps = {
      ...mockProps,
      isGenerating: true,
      isSubmitDisabled: true,
    };
    render(<DataGeneratorForm {...generatingProps} />);

    expect(screen.getByText(/Cancel Generation/i)).toBeInTheDocument();
    expect(screen.getByText(/Generating\.\.\./i)).toBeInTheDocument();
  });
});
