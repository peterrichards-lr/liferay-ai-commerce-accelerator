import React from 'react';
import { render, screen } from '@testing-library/react';
import ActivityLog from './ActivityLog';
import { stubScrollMetrics } from '../../testUtils/scrollMetrics';

describe('ActivityLog', () => {
  const mockLogs = [
    {
      id: 1,
      message: 'Step 1 complete',
      type: 'info',
      timestamp: '12:00:00',
    },
    {
      id: 2,
      message: 'Step 2 failed',
      type: 'error',
      timestamp: '12:01:00',
    },
  ];

  it('renders correctly with logs', () => {
    render(
      <ActivityLog logs={mockLogs} onClearLogs={vi.fn()} isGenerating={false} />
    );

    expect(screen.getByText(/Live Console/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 complete/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 2 failed/i)).toBeInTheDocument();
    expect(screen.getByText(/\[ERROR\]/i)).toBeInTheDocument();
  });

  it('shows waiting message when empty', () => {
    render(
      <ActivityLog logs={[]} onClearLogs={vi.fn()} isGenerating={false} />
    );

    expect(screen.getByText(/Waiting for activity/i)).toBeInTheDocument();
  });

  it('shows processing spinner when generating', () => {
    render(<ActivityLog logs={[]} onClearLogs={vi.fn()} isGenerating={true} />);

    expect(screen.getByText(/Processing/i)).toBeInTheDocument();
  });

  it('keeps the newest entry in view, which useActivityLog prepends', () => {
    const scroll = stubScrollMetrics();

    try {
      const { rerender } = render(
        <ActivityLog
          logs={mockLogs}
          onClearLogs={vi.fn()}
          isGenerating={true}
        />
      );

      rerender(
        <ActivityLog
          logs={[
            {
              id: 3,
              message: 'Step 3 started',
              type: 'info',
              timestamp: '12:02:00',
            },
            ...mockLogs,
          ]}
          onClearLogs={vi.fn()}
          isGenerating={true}
        />
      );

      expect(screen.getByText(/Step 3 started/i)).toBeInTheDocument();
      expect(scroll.lastPosition()).toBe(0);
    } finally {
      scroll.restore();
    }
  });
});
