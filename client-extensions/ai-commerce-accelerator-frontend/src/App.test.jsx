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

describe('App', () => {
  it('renders the application title and connects upon user action', async () => {
    const config = {
      title: 'Test Accelerator',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      microserviceUrl: 'http://localhost:3001',
      liferayUrl: 'http://localhost:8080',
    };
    render(<AppRoot config={config} />);

    expect(screen.getByText('Test Accelerator')).toBeInTheDocument();

    // Find and click the Test Connection button
    const testBtn = screen.getByText(/Test Connection & Load Data/i);
    fireEvent.click(testBtn);

    // Wait for MSW to respond and App to update connection status
    await waitFor(
      () => {
        expect(screen.getByText(/^Connected$/i)).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
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

    const testBtn = screen.getByText(/Test Connection & Load Data/i);
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(screen.getByText(/Demo Mode Active/i)).toBeInTheDocument();
    });
  });

  it('renders the main sections', () => {
    render(<AppRoot />);

    expect(screen.getByTestId('generator-form')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard')).toBeInTheDocument();
  });
});
