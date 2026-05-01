import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Dashboard from './Dashboard';

const initialProgress = {
  products: { total: 10, completed: 5, errors: [], batches: {} },
  accounts: { total: 10, completed: 0, errors: [], batches: {} },
  orders: { total: 50, completed: 0, errors: [], batches: {} },
  images: { expected: 10, total: 0, completed: 0, errors: [], batches: {} },
  pdfs: { expected: 10, total: 0, completed: 0, errors: [], batches: {} },
  warehouses: { total: 5, completed: 0, errors: [], batches: {} },
};

describe('Dashboard', () => {
  const mockProps = {
    progress: initialProgress,
    logs: [
      {
        id: 1,
        message: 'Step 1 complete',
        type: 'info',
        timestamp: new Date().toISOString(),
      },
    ],
    isGenerating: false,
    onClearLogs: vi.fn(),
    onReset: vi.fn(),
    generationConfig: { productCount: 10, accountCount: 10, orderCount: 50 },
    wsStatus: 'connected',
    batchErrors: [],
    clearBatchErrors: vi.fn(),
    onReconnect: vi.fn(),
    connected: true,
  };

  it('renders correctly with progress and logs', () => {
    render(<Dashboard {...mockProps} />);

    expect(screen.getByText(/Progress Monitor/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 complete/i)).toBeInTheDocument();
    // Check for the updated tooltip label for connected status
    expect(screen.getByTitle(/Live updates active/i)).toBeInTheDocument();
  });

  it('shows progress bars for products', () => {
    render(<Dashboard {...mockProps} />);

    // Target the specific progress count for products
    const productProgress = screen.getByText((content, element) => {
      return (
        element.tagName.toLowerCase() === 'span' &&
        element.classList.contains('progress-count') &&
        content.includes('5') &&
        content.includes('10')
      );
    });
    expect(productProgress).toBeInTheDocument();
  });

  it('triggers onReset when Reset button is clicked', () => {
    render(<Dashboard {...mockProps} />);

    const resetBtn = screen.getByTitle(/Reset progress counters/i);
    fireEvent.click(resetBtn);

    expect(mockProps.onReset).toHaveBeenCalled();
  });

  it('handles export actions', () => {
    // Mock global URL and Blob for exports
    global.URL.createObjectURL = vi.fn().mockReturnValue('mock-url');
    global.URL.revokeObjectURL = vi.fn();

    render(<Dashboard {...mockProps} />);

    const exportBtn = screen.getByText(/Export Summary/i);
    fireEvent.click(exportBtn);

    expect(screen.getByText(/Download started/i)).toBeInTheDocument();
  });

  it('shows empty state when no progress exists', () => {
    render(<Dashboard {...mockProps} progress={{}} logs={[]} />);

    expect(screen.getByText(/Ready to Accelerate/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Your dashboard will come alive/i)
    ).toBeInTheDocument();
  });
});
