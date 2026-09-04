import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConsolePanel, {
  displayTime,
  formatEntriesForClipboard,
  levelColor,
} from './ConsolePanel';

const entries = [
  { id: 1, level: 'INFO', message: 'Started run', timestamp: '12:00:00' },
  {
    id: 2,
    level: 'ERROR',
    message: 'Boom',
    timestamp: '2026-09-04T12:01:02.345Z',
  },
  { id: 3, level: 'WARN', message: 'Careful', timestamp: '12:02:00' },
];

describe('ConsolePanel helpers', () => {
  it('accepts both ISO and pre-formatted timestamps', () => {
    expect(displayTime('2026-09-04T12:01:02.345Z')).toBe('12:01:02');
    expect(displayTime('12:00:00')).toBe('12:00:00');
    expect(displayTime(undefined)).toBe('system');
  });

  it('formats entries for the clipboard as timestamped text', () => {
    expect(formatEntriesForClipboard(entries.slice(0, 2))).toBe(
      '[12:00:00] [INFO] Started run\n[12:01:02] [ERROR] Boom'
    );
  });

  it('colours known levels and falls back for unknown ones', () => {
    expect(levelColor('ERROR')).toBe('#EF4444');
    expect(levelColor('NOPE')).toBe('#E5E7EB');
  });
});

describe('ConsolePanel', () => {
  it('renders entries with level badges', () => {
    render(<ConsolePanel entries={entries} title="Test Console" />);

    expect(screen.getByText('Test Console')).toBeInTheDocument();
    expect(screen.getByText('Started run')).toBeInTheDocument();
    expect(screen.getByText('[ERROR]')).toBeInTheDocument();
  });

  it('filters by level', () => {
    render(<ConsolePanel entries={entries} title="Test Console" />);

    fireEvent.change(screen.getByLabelText('Filter by log level'), {
      target: { value: 'ERROR' },
    });

    expect(screen.getByText('Boom')).toBeInTheDocument();
    expect(screen.queryByText('Started run')).not.toBeInTheDocument();
  });

  it('filters by search query', () => {
    render(<ConsolePanel entries={entries} title="Test Console" />);

    fireEvent.change(screen.getByLabelText('Search logs'), {
      target: { value: 'careful' },
    });

    expect(screen.getByText('Careful')).toBeInTheDocument();
    expect(screen.queryByText('Boom')).not.toBeInTheDocument();
  });

  it('copies the visible entries to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // navigator.clipboard is getter-only under happy-dom.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<ConsolePanel entries={entries} title="Test Console" />);
    fireEvent.click(screen.getByTitle(/Copy the visible log entries/i));

    expect(writeText).toHaveBeenCalledWith(formatEntriesForClipboard(entries));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('copies only what the filter leaves visible', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // navigator.clipboard is getter-only under happy-dom.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<ConsolePanel entries={entries} title="Test Console" />);
    fireEvent.change(screen.getByLabelText('Filter by log level'), {
      target: { value: 'ERROR' },
    });
    fireEvent.click(screen.getByTitle(/Copy the visible log entries/i));

    expect(writeText).toHaveBeenCalledWith('[12:01:02] [ERROR] Boom');
  });

  it('reports expansion so a collapsed consumer can defer rendering', () => {
    const onOpenChange = vi.fn();
    render(
      <ConsolePanel
        collapsible
        defaultOpen={false}
        entries={entries}
        onOpenChange={onOpenChange}
        title="Collapsed Console"
      />
    );

    expect(screen.queryByText('Started run')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Collapsed Console'));

    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('does not render a clear button when no handler is supplied', () => {
    render(<ConsolePanel entries={entries} title="Test Console" />);
    expect(screen.queryByTitle('Clear console')).not.toBeInTheDocument();
  });
});
