import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AiSchemasPanel from './AiSchemasPanel';

const setValues = vi.fn();

vi.mock('../../hooks', () => ({
  useForm: vi.fn(),
  useObjectStorage: vi.fn(() => ({
    loading: false,
    saving: false,
    values: {
      'ai-schema-product': { type: 'object' },
      'ai-schema-account': { type: 'object' },
    },
    dirty: false,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    setValues,
  })),
}));

vi.mock('./SchemaEditor', () => ({
  default: ({ title }) => <div>{title}</div>,
}));

// FileReader in happy-dom does not drive onload from a Blob reliably, so drive
// it directly: the assertions are about the import logic, not the browser API.
function importFile(contents) {
  const listeners = {};
  vi.stubGlobal(
    'FileReader',
    class {
      set onload(fn) {
        listeners.onload = fn;
      }
      readAsText() {
        listeners.onload({ target: { result: contents } });
      }
    }
  );

  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new Blob([contents])] } });
}

describe('AiSchemasPanel export and import', () => {
  beforeEach(() => {
    setValues.mockClear();
  });

  it('offers both import and export controls', () => {
    render(<AiSchemasPanel />);

    expect(screen.getByLabelText('Import all schemas')).toBeInTheDocument();
    expect(screen.getByLabelText('Export all schemas')).toBeInTheDocument();
  });

  it('imports schemas that compile', async () => {
    render(<AiSchemasPanel />);

    importFile(
      JSON.stringify({
        schemas: { 'ai-schema-product': { type: 'object' } },
      })
    );

    await waitFor(() => expect(setValues).toHaveBeenCalled());

    const updater = setValues.mock.calls[0][0];
    expect(updater({})).toEqual({ 'ai-schema-product': { type: 'object' } });
  });

  it('accepts a bare map without the schemas wrapper', async () => {
    render(<AiSchemasPanel />);

    importFile(JSON.stringify({ 'ai-schema-order': { type: 'object' } }));

    await waitFor(() => expect(setValues).toHaveBeenCalled());
    expect(setValues.mock.calls[0][0]({})).toEqual({
      'ai-schema-order': { type: 'object' },
    });
  });

  it('rejects a schema that does not compile without discarding the valid ones', async () => {
    render(<AiSchemasPanel />);

    importFile(
      JSON.stringify({
        schemas: {
          'ai-schema-product': { type: 'object' },
          'ai-schema-account': { type: 'not-a-real-type' },
        },
      })
    );

    await waitFor(() => expect(setValues).toHaveBeenCalled());

    // The valid schema is still applied; the invalid one is simply absent.
    const applied = setValues.mock.calls[0][0]({});
    expect(applied['ai-schema-product']).toEqual({ type: 'object' });
    expect(applied['ai-schema-account']).toBeUndefined();
  });

  it('copies the schemas to the clipboard as the same payload export writes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<AiSchemasPanel />);
    fireEvent.click(screen.getByLabelText('Copy all schemas'));

    await waitFor(() => expect(writeText).toHaveBeenCalled());

    const payload = JSON.parse(writeText.mock.calls[0][0]);
    expect(payload.version).toBe('1.0.0');
    expect(payload.schemas['ai-schema-product']).toEqual({ type: 'object' });
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('ignores keys that are not known schemas', async () => {
    render(<AiSchemasPanel />);

    importFile(JSON.stringify({ schemas: { 'not-a-schema': { a: 1 } } }));

    await waitFor(() => {
      expect(setValues).not.toHaveBeenCalled();
    });
  });
});
