import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PromptEditor from './PromptEditor';

// Stands in for the CodeMirror instance so the editorDidMount wiring is
// observable. The wrapper reports a real box, which is the state a browser
// reaches only once the container has been laid out.
const codeMirror = vi.hoisted(() => {
  const refresh = vi.fn();

  return {
    editorFor: (wrapper) => ({
      getWrapperElement: () => wrapper,
      refresh,
    }),
    refresh,
  };
});

vi.mock('react-codemirror2', () => ({
  Controlled: ({ value, onBeforeChange, editorDidMount }) => (
    <textarea
      data-testid="codemirror-mock"
      ref={(node) => {
        if (!node) {
          return;
        }
        node.getBoundingClientRect = () => ({ height: 300, width: 640 });
        editorDidMount?.(codeMirror.editorFor(node), value, () => {});
      }}
      value={value}
      onChange={(e) => onBeforeChange(null, null, e.target.value)}
    />
  ),
}));

describe('PromptEditor', () => {
  beforeEach(() => {
    codeMirror.refresh.mockClear();
  });

  // The editors were blank until a remount because CodeMirror measured a
  // container that had no box yet (#833). refresh() on layout is the remedy,
  // and this component previously accepted no editorDidMount at all.
  it('refreshes the editor once its container has been laid out', async () => {
    render(
      <PromptEditor
        title="Product Prompt"
        configKey="ai-prompt-product"
        value="Test product prompt content"
        onChange={vi.fn()}
      />
    );

    await waitFor(() => expect(codeMirror.refresh).toHaveBeenCalled());
  });

  it('still calls an editorDidMount supplied by the caller', async () => {
    const editorDidMount = vi.fn();

    render(
      <PromptEditor
        title="Product Prompt"
        configKey="ai-prompt-product"
        value="Test product prompt content"
        onChange={vi.fn()}
        editorDidMount={editorDidMount}
      />
    );

    await waitFor(() => expect(editorDidMount).toHaveBeenCalledTimes(1));
  });

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
