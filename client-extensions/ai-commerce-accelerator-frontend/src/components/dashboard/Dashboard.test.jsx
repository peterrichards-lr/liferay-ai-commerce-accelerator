import React from 'react';
import { render, screen } from '@testing-library/react';
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

  it('renders correctly with progress', () => {
    render(<Dashboard {...mockProps} />);

    expect(screen.getByText(/Workflow Status/i)).toBeInTheDocument();
    expect(screen.getByText(/Overall Progress/i)).toBeInTheDocument();
  });

  it('shows progress for products', () => {
    render(<Dashboard {...mockProps} />);

    const productProgressText = screen.getByText('5 / 10');
    expect(productProgressText).toBeInTheDocument();
  });

  it('handles empty progress gracefully', () => {
    // Pass undefined for progress to trigger the null return in ProgressMonitor
    render(<Dashboard {...mockProps} progress={undefined} />);

    expect(screen.getByText(/Workflow Status/i)).toBeInTheDocument();
  });
});
