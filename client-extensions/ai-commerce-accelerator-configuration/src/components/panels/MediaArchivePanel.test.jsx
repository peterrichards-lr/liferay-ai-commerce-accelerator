import React from 'react';
import { render, screen } from '@testing-library/react';
import MediaArchivePanel from './MediaArchivePanel';

// #917: the archive decides whether a finished run can still be exported as a
// package, and its retention was environment-only - unchangeable on the PaaS
// instances, where the client extensions are deliberately not deployed.

const setValue = vi.fn();

let storedValues = {
  'media-archive-config': {
    maxSessions: 10,
    retain: true,
    retentionHours: 72,
  },
};

vi.mock('../../hooks', () => ({
  useForm: vi.fn(),
  useObjectStorage: vi.fn(() => ({
    loading: false,
    saving: false,
    values: storedValues,
    dirty: false,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    setValue,
  })),
}));

describe('MediaArchivePanel', () => {
  beforeEach(() => {
    storedValues = {
      'media-archive-config': {
        maxSessions: 10,
        retain: true,
        retentionHours: 72,
      },
    };
    setValue.mockClear();
  });

  it('offers the three settings that decide how long a run stays packageable', () => {
    render(<MediaArchivePanel />);

    expect(screen.getByText('Media Archive')).toBeInTheDocument();
    expect(screen.getByLabelText('Keep media for (hours)')).toHaveValue(72);
    expect(screen.getByLabelText('Runs kept')).toHaveValue(10);
    expect(
      screen.getByLabelText('Keep media staged while building a package')
    ).toBeChecked();
  });

  it('says the directory is not settable from here, and why', () => {
    render(<MediaArchivePanel />);

    // A form served from Liferay reaches the microservice on another machine.
    // Naming a directory on that machine through it is not a setting, it is a
    // write primitive.
    expect(screen.getByText('Set where it is deployed')).toBeInTheDocument();
    expect(screen.getByText('MEDIA_ARCHIVE_PATH')).toBeInTheDocument();
  });

  it('refuses a retention of zero rather than clamping it', () => {
    storedValues = {
      'media-archive-config': {
        maxSessions: 10,
        retain: true,
        retentionHours: 0,
      },
    };

    render(<MediaArchivePanel />);

    // Saving zero would read as "keep nothing" and delete every package
    // source on the next pass.
    expect(
      screen.getByText('Retention must be a whole number of hours, at least 1.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
  });

  it('refuses a run cap below one', () => {
    storedValues = {
      'media-archive-config': {
        maxSessions: 0,
        retain: true,
        retentionHours: 72,
      },
    };

    render(<MediaArchivePanel />);

    expect(
      screen.getByText('Runs kept must be a whole number, at least 1.')
    ).toBeInTheDocument();
  });
});
