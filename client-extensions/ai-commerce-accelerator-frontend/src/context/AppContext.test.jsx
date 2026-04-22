import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { AppProvider, useApp } from './AppContext';

const TestComponent = () => {
  const { config, setConfig } = useApp();
  return (
    <div>
      <span data-testid="title">{config.title}</span>
      <button onClick={() => setConfig({ title: 'New Title' })}>Change Title</button>
    </div>
  );
};

describe('AppContext', () => {
  it('provides default config to children', () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );
    
    expect(screen.getByTestId('title')).toHaveTextContent(/AI Commerce Accelerator/i);
  });

  it('updates config via setConfig', async () => {
    render(
      <AppProvider>
        <TestComponent />
      </AppProvider>
    );

    const btn = screen.getByText('Change Title');
    await act(async () => {
        btn.click();
    });

    expect(screen.getByTestId('title')).toHaveTextContent('New Title');
  });

  it('initializes with provided config', () => {
    const initialConfig = { title: 'Custom App' };
    render(
      <AppProvider initialConfig={initialConfig}>
        <TestComponent />
      </AppProvider>
    );

    expect(screen.getByTestId('title')).toHaveTextContent('Custom App');
  });
});
