import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import SchemaEditor from './SchemaEditor';

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

describe('SchemaEditor', () => {
  beforeEach(() => {
    codeMirror.refresh.mockClear();
  });

  // The editors were blank until a remount because CodeMirror measured a
  // container that had no box yet (#833). This component already forwarded an
  // editorDidMount prop, and nothing in the application ever passed one.
  it('refreshes the editor once its container has been laid out', async () => {
    render(
      <SchemaEditor
        title="Product Schema"
        configKey="ai-schema-product"
        value="{}"
        onChange={vi.fn()}
      />
    );

    await waitFor(() => expect(codeMirror.refresh).toHaveBeenCalled());
  });

  it('still calls an editorDidMount supplied by the caller', async () => {
    const editorDidMount = vi.fn();

    render(
      <SchemaEditor
        title="Product Schema"
        configKey="ai-schema-product"
        value="{}"
        onChange={vi.fn()}
        editorDidMount={editorDidMount}
      />
    );

    await waitFor(() => expect(editorDidMount).toHaveBeenCalledTimes(1));
  });

  it('reports validation errors alongside the editor', () => {
    render(
      <SchemaEditor
        title="Product Schema"
        configKey="ai-schema-product"
        value="{}"
        onChange={vi.fn()}
        errors={['Unexpected token }']}
      />
    );

    expect(screen.getByText('Unexpected token }')).toBeInTheDocument();
    expect(screen.getByText('ai-schema-product')).toBeInTheDocument();
  });
});
