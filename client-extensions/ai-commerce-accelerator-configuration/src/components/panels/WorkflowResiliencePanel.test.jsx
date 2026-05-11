import React from 'react';
import { render, screen } from '@testing-library/react';
import WorkflowResiliencePanel from './WorkflowResiliencePanel';

// Mock the custom hooks used in the panel
vi.mock('../../hooks', () => ({
  useForm: vi.fn(),
  useObjectStorage: vi.fn().mockReturnValue({
    loading: false,
    saving: false,
    values: {
      'workflow-resilience-config': {
        initialDelayMs: 5000,
        maxRetries: 5,
        multiplier: 2,
      },
    },
    dirty: false,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    setValue: vi.fn(),
  }),
}));

// Mock MillisecondsInput since it might have complex logic or depend on other things
vi.mock('../common/MillisecondsInput', () => ({
  default: ({ label, value }) => (
    <div>
      <label>{label}</label>
      <input defaultValue={value} />
    </div>
  ),
}));

describe('WorkflowResiliencePanel', () => {
  it('renders the resilience configuration fields', () => {
    render(<WorkflowResiliencePanel />);

    expect(screen.getByText('Workflow Resilience')).toBeInTheDocument();
    expect(screen.getByText('Initial Delay (ms)')).toBeInTheDocument();
    expect(screen.getByText('Maximum Retries')).toBeInTheDocument();
    expect(screen.getByText('Backoff Multiplier')).toBeInTheDocument();

    // Verify initial values
    expect(screen.getByLabelText(/Maximum Retries/i)).toHaveValue(5);
    expect(screen.getByLabelText(/Backoff Multiplier/i)).toHaveValue(2);
  });
});
