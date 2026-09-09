import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AppRoot from './App';

// Mock child components but allow them to render enough to be identified
vi.mock('./components/data-generator/DataGeneratorForm', () => ({
  default: ({ generationConfig }) => (
    <div data-testid="generator-form">
      {generationConfig.demoMode ? 'Demo Mode Active' : 'Live Mode Active'}
    </div>
  ),
}));

vi.mock('./components/dashboard/Dashboard', () => ({
  default: () => <div data-testid="dashboard">Dashboard</div>,
}));

// Only the hook itself is replaced. `isServiceSourced` is a real named export
// that App calls on every log entry to decide whether to raise a toast, and a
// mock that omits it makes addLog throw. That throw was swallowed by
// testConnection's catch, so the suite reported 242 passing while the path was
// broken - the nightly E2E log was the only place it surfaced.
// The replacement returns the hook's real shape. It previously returned an
// `isConnected` key the hook has never had, so App read `wsConnected` as
// undefined and the 'Disconnected' assertion below passed for the wrong
// reason - a mock drifting from the module it stands in for is what broke
// `isServiceSourced` in the first place.
vi.mock('./hooks/useRealtimeWebSocket', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({
    wsRef: { current: null },
    wsConnected: false,
    reconnect: vi.fn(),
    ping: vi.fn(),
  }),
}));

describe('App', () => {
  it('renders the application title and initial disconnected state', async () => {
    const config = {
      title: 'Test Accelerator',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      microserviceUrl: 'http://localhost:3001',
      liferayUrl: 'http://localhost:8080',
    };
    render(<AppRoot config={config} />);

    expect(screen.getByText('Test Accelerator')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();

    // Verify the connection button is present
    const testBtn = screen.getByRole('button', {
      name: /Test Connection & Load Data/i,
    });
    expect(testBtn).toBeInTheDocument();
  });

  it('updates generation config when AI credentials are missing', async () => {
    // Override handler to return aiKeyAvailable: false
    const { http, HttpResponse } = await import('msw');
    const { server } = await import('./mocks/server');

    server.use(
      http.post('http://localhost:3001/api/v1/test-connection', () => {
        return HttpResponse.json({
          success: true,
          message: 'Connected to Liferay (no AI).',
          aiKeyAvailable: false,
          openAiKeyAvailable: false,
          liferayUrl: 'http://liferay-test:8080',
        });
      })
    );

    const config = {
      title: 'Test Accelerator',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      microserviceUrl: 'http://localhost:3001',
    };
    render(<AppRoot config={config} />);

    const testBtn = screen.getByRole('button', {
      name: /Test Connection & Load Data/i,
    });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText(/Demo Mode Active/i)).toBeInTheDocument();
    });
  });

  it('renders the main sections', async () => {
    render(<AppRoot />);

    await waitFor(() => {
      expect(screen.getByTestId('generator-form')).toBeInTheDocument();
    });
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });
});
