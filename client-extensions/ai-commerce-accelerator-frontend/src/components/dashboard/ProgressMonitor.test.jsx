import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ProgressMonitor from './ProgressMonitor';

describe('ProgressMonitor', () => {
  const mockProgress = {
    workflowStatus: 'running',
    products: { total: 10, completed: 5, isDone: false, errors: [] },
    accounts: { total: 5, completed: 0, isDone: false, errors: [] },
    orders: { total: 0, completed: 0, isDone: false, errors: [] },
    warehouses: { total: 0, completed: 0, isDone: false, errors: [] },
    addresses: { total: 0, completed: 0, isDone: false, errors: [] },
    images: { total: 0, completed: 0, isDone: false, errors: [] },
    pdfs: { total: 0, completed: 0, isDone: false, errors: [] },
    priceLists: { total: 0, completed: 0, isDone: false, errors: [] },
    promotions: { total: 0, completed: 0, isDone: false, errors: [] },
  };

  it('should render "Verifying..." when batch is 100% but isDone is false', () => {
    const progressWithVerifying = {
      ...mockProgress,
      products: { total: 10, completed: 10, isDone: false, errors: [] },
    };

    render(<ProgressMonitor progress={progressWithVerifying} />);

    // Check that 'Products' row shows 'Verifying...'
    const productsRow = screen
      .getByText('Products')
      .closest('div').parentElement;
    expect(productsRow).toHaveTextContent('Verifying...');
    expect(productsRow).not.toHaveTextContent('Done');
  });

  it('should render "Done" only when explicitIsDone is true', () => {
    const progressWithDone = {
      ...mockProgress,
      products: { total: 10, completed: 10, isDone: true, errors: [] },
    };

    render(<ProgressMonitor progress={progressWithDone} />);

    const productsRow = screen
      .getByText('Products')
      .closest('div').parentElement;
    expect(productsRow).toHaveTextContent('Done');
    expect(productsRow).not.toHaveTextContent('Verifying...');
  });

  it('should render "Done" for all items when workflowStatus is completed', () => {
    const completedProgress = {
      ...mockProgress,
      workflowStatus: 'completed',
    };

    render(<ProgressMonitor progress={completedProgress} />);

    // In completed status, all rows should show 'Done' even if counts are 0
    const doneBadges = screen.getAllByText('Done');
    // 5 main rows + other asset rows that use MiniProgressItem
    expect(doneBadges.length).toBeGreaterThanOrEqual(5);
  });

  it('should show error badge when there are errors', () => {
    const progressWithErrors = {
      ...mockProgress,
      accounts: {
        total: 5,
        completed: 2,
        isDone: false,
        errors: [{ message: 'Fail' }],
      },
    };

    render(<ProgressMonitor progress={progressWithErrors} />);

    expect(screen.getByText('1 Err')).toBeInTheDocument();
  });
});

// The delete flow declared itself complete the moment the request was
// accepted, and every bar took a "Done" from it - including the products
// still sitting at PREPARED 0 of 50 and the seven entities the run had not
// reached (#786).
describe('a delete still running puts no Done on a bar (#786)', () => {
  const runAtSixOfFifteenSteps = {
    workflowStatus: 'completed',
    totalSteps: 15,
    completedSteps: 6,
    products: { total: 50, completed: 0, isDone: false, errors: [] },
    accounts: { total: 2, completed: 0, isDone: false, errors: [] },
    orders: { total: 32, completed: 32, isDone: true, errors: [] },
    warehouses: { total: 5, completed: 5, isDone: true, errors: [] },
    addresses: { total: 0, completed: 0, isDone: false, errors: [] },
    images: { total: 0, completed: 0, isDone: false, errors: [] },
    pdfs: { total: 0, completed: 0, isDone: false, errors: [] },
    priceLists: { total: 2, completed: 0, isDone: false, errors: [] },
    promotions: { total: 2, completed: 0, isDone: false, errors: [] },
  };

  const rowFor = (title) =>
    screen.getByText(title).closest('div').parentElement;

  it('leaves a step that has not run reading Pending', () => {
    render(<ProgressMonitor progress={runAtSixOfFifteenSteps} isDelete />);

    expect(rowFor('Products')).toHaveTextContent('Pending');
    expect(rowFor('Products')).not.toHaveTextContent('Done');
    expect(rowFor('Accounts')).not.toHaveTextContent('Done');
  });

  it('still shows Done on the steps that did report', () => {
    render(<ProgressMonitor progress={runAtSixOfFifteenSteps} isDelete />);

    expect(rowFor('Orders')).toHaveTextContent('Done');
    expect(rowFor('Warehouses')).toHaveTextContent('Done');
  });

  it('settles every bar once the run really has finished', () => {
    render(
      <ProgressMonitor
        progress={{ ...runAtSixOfFifteenSteps, completedSteps: 15 }}
        isDelete
      />
    );

    expect(rowFor('Products')).toHaveTextContent('Done');
    expect(screen.getAllByText('Done').length).toBeGreaterThanOrEqual(5);
  });
});
