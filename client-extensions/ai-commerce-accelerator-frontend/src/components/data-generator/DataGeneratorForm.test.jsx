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
  enableBackorders: true,
  backorderAssignmentRatio: 50,
  createWarehouses: true,
  reuseExistingWarehouses: true,
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
    expect(screen.getByLabelText(/^B2B Accounts$/i)).toHaveValue(10);
    expect(screen.getByLabelText(/^Historical Orders$/i)).toHaveValue(50);
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

    expect(mockProps.onGenerate).toHaveBeenCalledWith(initialGenerationConfig);
  });

  it('disables submit button and shows loading state when generating', () => {
    const generatingProps = {
      ...mockProps,
      isGenerating: true,
      isSubmitDisabled: true,
    };
    render(<DataGeneratorForm {...generatingProps} />);

    const submitBtn = screen.getByRole('button', {
      name: /Generating Demo Data\.\.\./i,
    });
    expect(submitBtn).toBeDisabled();
  });
});
