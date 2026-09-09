import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import CategoriesConfigPanel from './CategoriesConfigPanel';

const setValue = vi.fn();

vi.mock('../../hooks', () => ({
  useForm: vi.fn(),
  useObjectStorage: vi.fn(() => ({
    loading: false,
    saving: false,
    values: { 'ai-categories': ['Helmets', 'Riding Boots'] },
    // Dirty, so Save is enabled unless something else disables it. Otherwise
    // the assertions below would pass for the wrong reason.
    dirty: true,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    setValue,
  })),
}));

vi.mock('react-codemirror2', () => ({
  Controlled: ({ value, onBeforeChange }) => (
    <textarea
      data-testid="codemirror-mock"
      value={value}
      onChange={(e) => onBeforeChange(null, null, e.target.value)}
    />
  ),
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

  fireEvent.change(document.querySelector('input[type="file"]'), {
    target: { files: [new Blob([contents])] },
  });
}

const saveButton = () =>
  screen.getByRole('button', { name: 'Save categories configuration' });

describe('CategoriesConfigPanel import and export', () => {
  beforeEach(() => {
    setValue.mockClear();
  });

  it('offers both controls', () => {
    render(<CategoriesConfigPanel />);

    expect(
      screen.getByRole('button', { name: 'Import Categories Configuration' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Export Categories Configuration' })
    ).toBeInTheDocument();
  });

  it('shows the imported list in the editor', () => {
    render(<CategoriesConfigPanel />);

    importFile('["Gloves", "Body Armour"]');

    expect(setValue).toHaveBeenCalledWith('ai-categories', [
      'Gloves',
      'Body Armour',
    ]);
  });

  // An import that could bypass the schema would be a worse feature than no
  // import at all: a file is the one route where nobody watched it being typed.
  describe('an import is validated exactly as typing is', () => {
    it('reports malformed JSON and blocks Save', () => {
      render(<CategoriesConfigPanel />);

      expect(saveButton()).not.toBeDisabled();

      importFile('["Gloves",');

      expect(screen.getByText(/JSON Parse Error/)).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it('reports a document that parses but breaks the schema', () => {
      render(<CategoriesConfigPanel />);

      // Valid JSON, wrong shape: the categories list is an array of non-empty
      // strings, and a schema check is the only thing that catches this.
      importFile('[{"name": "Helmets"}]');

      expect(screen.getByText(/Validation Error/)).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it('rejects duplicates, which a hand-merged file invites', () => {
      render(<CategoriesConfigPanel />);

      importFile('["Helmets", "Helmets"]');

      expect(screen.getByText(/Validation Error/)).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it('accepts a well-formed list and leaves Save available', () => {
      render(<CategoriesConfigPanel />);

      importFile('["Helmets", "Riding Boots", "Gloves"]');

      expect(screen.queryByText(/Error/)).not.toBeInTheDocument();
      expect(saveButton()).not.toBeDisabled();
    });
  });
});
