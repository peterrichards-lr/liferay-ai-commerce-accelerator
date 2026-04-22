import React from 'react';
import { render, screen } from '@testing-library/react';
import LiferayAICommerceAcceleratorConfiguration from './LiferayAICommerceAcceleratorConfiguration';

vi.mock('./panels', () => ({
  PANELS: [
    {
      id: 'test',
      label: 'Test Panel',
      component: () => <div data-testid="active-panel">Test Content</div>,
    },
  ],
}));

describe('LiferayAICommerceAcceleratorConfiguration', () => {
  it('renders the component with navigation and active panel', () => {
    render(<LiferayAICommerceAcceleratorConfiguration />);

    // Check for navigation header
    expect(screen.getByText('Configuration')).toBeInTheDocument();

    // Check for the mock panel in navigation
    expect(screen.getAllByText('Test Panel')[0]).toBeInTheDocument();

    // Check for active panel content
    expect(screen.getByTestId('active-panel')).toBeInTheDocument();
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });
});
