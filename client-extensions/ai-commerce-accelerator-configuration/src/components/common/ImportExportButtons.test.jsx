import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ImportExportButtons from './ImportExportButtons';

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

const renderButtons = (props = {}) =>
  render(
    <ImportExportButtons
      filename="ai-categories.json"
      label="Categories Configuration"
      onImport={vi.fn()}
      text='["Helmets"]'
      {...props}
    />
  );

describe('ImportExportButtons', () => {
  it('names both controls after what they act on', () => {
    renderButtons();

    expect(
      screen.getByRole('button', { name: 'Import Categories Configuration' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Export Categories Configuration' })
    ).toBeInTheDocument();
  });

  // The whole point of the pair: a document handed to a colleague, and one
  // handed back. Exporting under a name nobody recognises defeats it.
  it('exports under the configuration key, so the file names its own home', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;

    const clicked = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        el.click = () => clicked.push(el.download);
      }
      return el;
    });

    renderButtons();
    fireEvent.click(
      screen.getByRole('button', { name: 'Export Categories Configuration' })
    );

    expect(clicked).toEqual(['ai-categories.json']);
    // Revoked as well as created, or a long editing session leaks a blob per
    // export.
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    document.createElement.mockRestore();
  });

  it('hands the file to the caller as text, never as parsed data', async () => {
    const onImport = vi.fn();

    renderButtons({ onImport });
    importFile('["Riding Boots"]');

    // Text, so the panel's own parse and schema check run on it exactly as
    // they do on a keystroke. Passing an object would skip both.
    expect(onImport).toHaveBeenCalledWith('["Riding Boots"]');
  });

  it('hands over malformed content too, rather than swallowing it', () => {
    const onImport = vi.fn();

    renderButtons({ onImport });
    importFile('{ not json');

    // Rejecting it here would report the problem somewhere the panel cannot
    // see, and leave the editor showing the old value with no explanation.
    expect(onImport).toHaveBeenCalledWith('{ not json');
  });

  it('offers nothing to export when there is nothing to export', () => {
    renderButtons({ text: '' });

    expect(
      screen.getByRole('button', { name: 'Export Categories Configuration' })
    ).toBeDisabled();
  });

  it('accepts JSON by default and markdown when asked', () => {
    const { unmount } = renderButtons();
    expect(document.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      '.json'
    );
    unmount();

    renderButtons({ accept: '.md,.txt' });
    expect(document.querySelector('input[type="file"]')).toHaveAttribute(
      'accept',
      '.md,.txt'
    );
  });
});
