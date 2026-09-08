import { describe, expect, it } from 'vitest';
import {
  fileTimestamp,
  isGeneratedSessionName,
  sessionExportFilename,
  slugify,
} from './sessionFilename';

// Local wall-clock, matching what the generated session name records.
const AT = new Date(2026, 8, 8, 19, 12, 55);
const STAMP = '2026-09-08T19-12-55';

describe('sessionExportFilename', () => {
  // The bug this replaces: exports were named by date alone, so two runs on
  // the same day produced the same filename. Both log exports from
  // 2026-09-08 were called aica-logs-generate-2026-09-08.json.
  it('never names two runs on one day the same thing', () => {
    const morning = sessionExportFilename('aica-logs-generate', '', {
      date: new Date(2026, 8, 8, 9, 0, 0),
    });
    const evening = sessionExportFilename('aica-logs-generate', '', {
      date: new Date(2026, 8, 8, 19, 12, 55),
    });

    expect(morning).not.toBe(evening);
  });

  // MM-DD-YYYY reads as either the 8th of September or the 9th of August. The
  // generated name is reordered rather than reused verbatim, so every filename
  // here carries one unambiguous format.
  it('reorders a generated session name instead of adding a second timestamp', () => {
    expect(
      sessionExportFilename('aica-logs-generate', '09-08-2026_19:12:55', {
        date: AT,
      })
    ).toBe(`aica-logs-generate-${STAMP}.json`);
  });

  it('gives a generated name and an unset one the same shape', () => {
    expect(
      sessionExportFilename('aica-logs-generate', '09-08-2026_19:12:55', {
        date: AT,
      })
    ).toBe(sessionExportFilename('aica-logs-generate', '', { date: AT }));
  });

  // Reordering only. Converting to UTC would move the time away from the one
  // the session name shows and the operator's clock made.
  it('keeps the instant the generated name records, whatever the export time', () => {
    expect(
      sessionExportFilename('aica-logs-generate', '01-02-2026_03:04:05', {
        date: AT,
      })
    ).toBe('aica-logs-generate-2026-01-02T03-04-05.json');
  });

  it('adds a timestamp to a name the operator chose', () => {
    // Their name identifies the run but not the attempt: the same name is
    // reused across reruns, so the time is what tells them apart.
    expect(
      sessionExportFilename('aica-logs-generate', 'Solara Moto', { date: AT })
    ).toBe(`aica-logs-generate-Solara-Moto-${STAMP}.json`);
  });

  it('falls back to a timestamp when no name was set', () => {
    expect(sessionExportFilename('aica-logs-generate', '', { date: AT })).toBe(
      `aica-logs-generate-${STAMP}.json`
    );
    expect(
      sessionExportFilename('aica-logs-generate', undefined, { date: AT })
    ).toBe(`aica-logs-generate-${STAMP}.json`);
  });

  it('keeps a name that is only punctuation from producing a stray dash', () => {
    expect(
      sessionExportFilename('aica-logs-generate', '***', { date: AT })
    ).toBe(`aica-logs-generate-${STAMP}.json`);
  });

  it('carries the flow type through the prefix', () => {
    expect(
      sessionExportFilename('aica-logs-delete', 'Solara Moto', { date: AT })
    ).toBe(`aica-logs-delete-Solara-Moto-${STAMP}.json`);
  });
});

describe('slugify', () => {
  it('makes a typed name safe for a filesystem', () => {
    expect(slugify('Solara/Moto: Q1 *demo*')).toBe('Solara-Moto-Q1-demo');
  });

  // Their label, so their capitals. Lowercasing makes the file harder to
  // recognise in a folder, not easier.
  it('preserves the case the operator typed', () => {
    expect(slugify('Solara Moto')).toBe('Solara-Moto');
  });

  it('does not leave a trailing dash after truncating', () => {
    const slug = slugify('a'.repeat(58) + ' tail', { maxLength: 60 });

    expect(slug).not.toMatch(/-$/);
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});

describe('fileTimestamp', () => {
  it('has no colons, which Windows rejects and macOS mangles', () => {
    expect(fileTimestamp(AT)).toBe(STAMP);
    expect(fileTimestamp(AT)).not.toContain(':');
  });

  it('reads local wall-clock, not UTC', () => {
    // The generated session name comes from toLocaleString, so a UTC stamp
    // would put two runs a minute apart an hour apart in the filename.
    const local = new Date(2026, 0, 2, 3, 4, 5);

    expect(fileTimestamp(local)).toBe('2026-01-02T03-04-05');
  });

  it('sorts chronologically as a string', () => {
    const earlier = fileTimestamp(new Date(2026, 8, 8, 9, 0, 0));
    const later = fileTimestamp(new Date(2026, 8, 8, 19, 12, 55));

    expect(earlier < later).toBe(true);
  });
});

describe('isGeneratedSessionName', () => {
  it('recognises the form the generator produces', () => {
    expect(isGeneratedSessionName('09-08-2026_19:12:55')).toBe(true);
  });

  it('does not mistake an operator name for one', () => {
    expect(isGeneratedSessionName('Solara Moto')).toBe(false);
    expect(isGeneratedSessionName('2026-09-08')).toBe(false);
    expect(isGeneratedSessionName('')).toBe(false);
  });
});
