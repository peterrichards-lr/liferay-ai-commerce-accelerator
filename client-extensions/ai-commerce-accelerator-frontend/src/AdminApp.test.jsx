import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import AdminRootWithContext from './AdminApp';

describe('AdminApp UI', () => {
  it('should render AI Media as inherited with a success tick when correctly configured', async () => {
    const { http, HttpResponse } = await import('msw');
    const { server } = await import('./mocks/server');

    server.use(
      http.get('http://localhost:3001/api/v1/config/health', () => {
        return HttpResponse.json({
          success: true,
          health: {
            liferay: { status: 'CONNECTED' },
            aiText: { status: 'CONFIGURED', provider: 'OPENAI' },
            aiMedia: { status: 'CONFIGURED', provider: 'INHERIT' },
            prompts: { status: 'OK', missing: [] },
            schemas: { status: 'OK', missing: [] },
          },
        });
      }),
      http.get('http://localhost:3001/api/v1/health/detailed', () => {
        return HttpResponse.json({
          success: true,
          service: 'liferay-ai-data-microservice',
          uptime: 1000,
          memory: { used: 100, total: 200 },
          node: { platform: 'darwin', arch: 'arm64' },
          health: {
            checks: {
              memory: { message: 'Memory usage: 50%' },
              disk: { message: 'Sufficient' },
            },
          },
        });
      }),
      http.get('http://localhost:3001/api/v1/workflows/sessions', () =>
        HttpResponse.json({ success: true, sessions: [] })
      ),
      http.get('http://localhost:3001/api/v1/workflows/kpis', () =>
        HttpResponse.json({ success: true, kpis: {} })
      )
    );

    const config = {
      microserviceUrl: 'http://localhost:3001',
      liferayUrl: 'http://localhost:8080',
    };

    render(<AdminRootWithContext config={config} />);

    // Wait for the inherited message to appear
    await waitFor(() => {
      expect(
        screen.getByText('Inheriting from Core AI (OPENAI)')
      ).toBeInTheDocument();
    });

    // Find the AI Media HealthItem
    const aiMediaContainer = screen.getByText('AI Media').closest('.d-flex');
    expect(aiMediaContainer).toHaveTextContent(
      'Inheriting from Core AI (OPENAI)'
    );

    // Verify the success color class (text-success) and icon (check-circle-full) are applied
    const iconElement = aiMediaContainer.querySelector('.text-success');
    expect(iconElement).toBeInTheDocument();

    // Explicitly check for the green tick icon (lexicon-icon-check-circle-full)
    expect(
      aiMediaContainer.querySelector('.lexicon-icon-check-circle-full')
    ).toBeInTheDocument();
  });
});
