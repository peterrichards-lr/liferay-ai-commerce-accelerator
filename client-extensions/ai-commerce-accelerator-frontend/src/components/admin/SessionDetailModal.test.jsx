import React from 'react';
import { render, screen } from '@testing-library/react';
import { AppProvider } from '../../context/AppContext';
import { TEST_SPRITEMAP } from '../../testUtils/render';
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

  // The modal fetches the session's events as it mounts. Each test waits for
  // them, so its assertions describe the settled modal, and the request does
  // not outlive the test, where unmounting aborted it and the component logged
  // the abort as a failure (#1353). 'Workflow started' is the MSW handler's
  // event.
  const renderSettled = async (ui) => {
    const view = render(
      <AppProvider
        initialConfig={{
          microserviceUrl: 'http://localhost:3001',
          spritemap: TEST_SPRITEMAP,
        }}
      >
        {ui}
      </AppProvider>
    );
    await screen.findByText('Workflow started');
    return view;
  };

  it('renders session basic information correctly', async () => {
    await renderSettled(
      <SessionDetailModal session={mockSession} onClose={() => {}} />
    );

    expect(screen.getByText('Test Session')).toBeInTheDocument();
    expect(screen.getByText('SESS-123')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('generate')).toBeInTheDocument();
  });

  it('redacts sensitive information in the JSON view', async () => {
    await renderSettled(
      <SessionDetailModal session={mockSession} onClose={() => {}} />
    );

    expect(screen.getByText(/Workflow Configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/\[REDACTED\]/i)).toBeInTheDocument();
  });

  it('renders target totals if present', async () => {
    await renderSettled(
      <SessionDetailModal session={mockSession} onClose={() => {}} />
    );

    expect(screen.getByText('Generated Quantities')).toBeInTheDocument();
    expect(screen.getByText('products')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('accounts')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders the terminal error message if session failed', async () => {
    const failedSession = {
      ...mockSession,
      status: 'FAILED',
      error_message: 'Out of memory',
    };
    await renderSettled(
      <SessionDetailModal session={failedSession} onClose={() => {}} />
    );

    expect(screen.getByText('Terminal Error')).toBeInTheDocument();
    expect(screen.getByText('Out of memory')).toBeInTheDocument();
  });

  it('handles sessions with missing or invalid context gracefully', async () => {
    const brokenSession = { ...mockSession, context: 'invalid-json' };
    await renderSettled(
      <SessionDetailModal session={brokenSession} onClose={() => {}} />
    );

    expect(
      screen.queryByText('Workflow Configuration')
    ).not.toBeInTheDocument();
    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });
});
