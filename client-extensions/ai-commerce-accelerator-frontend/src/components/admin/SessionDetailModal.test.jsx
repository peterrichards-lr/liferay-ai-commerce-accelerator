import React from 'react';
import { render, screen } from '@testing-library/react';
import SessionDetailModal from './SessionDetailModal';

describe('SessionDetailModal', () => {
  const mockSession = {
    session_id: 'SESS-123',
    session_name: 'Test Session',
    status: 'COMPLETED',
    flow_type: 'generate',
    created_at: '2026-05-07T12:00:00Z',
    context: JSON.stringify({
      options: {
        brandName: 'Test Brand',
        geographicContext: { countryTitle: 'USA' },
      },
      config: {
        liferayUrl: 'http://localhost:8080',
        clientSecret: 'super-secret',
      },
      totals: {
        products: 10,
        accounts: 5,
      },
    }),
  };

  it('renders session basic information correctly', () => {
    render(<SessionDetailModal session={mockSession} onClose={() => {}} />);

    expect(screen.getByText('Test Session')).toBeInTheDocument();
    expect(screen.getByText('SESS-123')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('generate')).toBeInTheDocument();
  });

  it('redacts sensitive information in the JSON view', () => {
    render(<SessionDetailModal session={mockSession} onClose={() => {}} />);

    const jsonContainer =
      screen.getByText(/Workflow Context/i).nextElementSibling;
    expect(jsonContainer).toHaveTextContent('[REDACTED]');
    expect(jsonContainer).not.toHaveTextContent('super-secret');
  });

  it('renders target totals if present', () => {
    render(<SessionDetailModal session={mockSession} onClose={() => {}} />);

    expect(screen.getByText('Target Totals')).toBeInTheDocument();
    expect(screen.getByText('products')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('accounts')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders the terminal error message if session failed', () => {
    const failedSession = {
      ...mockSession,
      status: 'FAILED',
      error_message: 'Out of memory',
    };
    render(<SessionDetailModal session={failedSession} onClose={() => {}} />);

    expect(screen.getByText('Terminal Error')).toBeInTheDocument();
    expect(screen.getByText('Out of memory')).toBeInTheDocument();
  });

  it('handles sessions with missing or invalid context gracefully', () => {
    const brokenSession = { ...mockSession, context: 'invalid-json' };
    render(<SessionDetailModal session={brokenSession} onClose={() => {}} />);

    expect(screen.queryByText('Workflow Context')).not.toBeInTheDocument();
    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });
});
