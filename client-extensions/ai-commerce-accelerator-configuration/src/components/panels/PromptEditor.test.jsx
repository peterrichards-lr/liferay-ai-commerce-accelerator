import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PromptEditor from './PromptEditor';

vi.mock('react-codemirror2', () => ({
  Controlled: ({ value, onBeforeChange }) => (
    <textarea
      data-testid="codemirror-mock"
      value={value}
      onChange={(e) => onBeforeChange(null, null, e.target.value)}
    />
  ),
}));

describe('PromptEditor', () => {
  it('renders title and configuration key', () => {
    render(
      <PromptEditor
        title="Product Prompt"
        configKey="ai-prompt-product"
        value="Test product prompt content"
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('Product Prompt')).toBeInTheDocument();
    expect(screen.getByText('ai-prompt-product')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /import product prompt/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /export product prompt/i })
    ).toBeInTheDocument();
  });

  it('triggers download when export is clicked', () => {
    const createObjectURLMock = vi
      .fn()
      .mockReturnValue('blob:http://localhost/1234');
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    render(
      <PromptEditor
        title="Product Prompt"
        configKey="ai-prompt-product"
        value="Sample prompt content"
        onChange={vi.fn()}
      />
    );

    const exportBtn = screen.getByRole('button', {
      name: /export product prompt/i,
    });
    fireEvent.click(exportBtn);

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
  });

  it('reads file and calls onChange when import file is selected', async () => {
    const onChangeMock = vi.fn();
    const { container } = render(
      <PromptEditor
        title="Product Prompt"
        configKey="ai-prompt-product"
        value="Initial content"
        onChange={onChangeMock}
      />
    );

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();

    const file = new File(['Imported prompt content'], 'prompt.md', {
      type: 'text/markdown',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await vi.waitFor(() => {
      expect(onChangeMock).toHaveBeenCalledWith('Imported prompt content');
    });
  });
});
