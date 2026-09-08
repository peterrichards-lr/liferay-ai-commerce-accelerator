/**
 * Naming an export after the run it describes.
 *
 * Exports were named `<prefix>-<date>.json`, so two runs on the same day
 * produced the same filename. Both log exports from 2026-09-08 were called
 * `aica-logs-generate-2026-09-08.json` and were only told apart by which
 * folder they had been saved into.
 *
 * The session name is the operator's own label for a run, so it is what an
 * export should carry. It comes in two forms:
 *
 *   - Unset, in which case the form supplies a timestamp of its own,
 *     `MM-DD-YYYY_HH:MM:SS`. That already identifies the run, so it is not
 *     given a second one - but it is reordered, because `09-08-2026` reads as
 *     either the 8th of September or the 9th of August and the ISO order does
 *     not.
 *   - Set by the operator, in which case it names the run but does not place
 *     it in time - the same name is reused across attempts - so a timestamp
 *     is added.
 *
 * Either way the result carries a time and not merely a date, because runs
 * that collided were minutes apart, not days.
 *
 * Times are local wall-clock throughout. The generated session name comes from
 * toLocaleString, so it already is; using UTC for the other cases would leave
 * two runs a minute apart looking an hour apart to anyone west or east of it,
 * and a filename is read by the person whose clock made it.
 */

/** The shape the generator produces when the operator leaves the name blank. */
const GENERATED_NAME = /^\d{2}-\d{2}-\d{4}_\d{2}:\d{2}:\d{2}$/;

/** Longest slug taken from an operator's name, to keep filenames workable. */
const MAX_SLUG_LENGTH = 60;

export function isGeneratedSessionName(sessionName) {
  return GENERATED_NAME.test(String(sessionName || '').trim());
}

/**
 * A filesystem-safe form of whatever the operator typed.
 *
 * Case is preserved: it is their label, and lowercasing "Solara Moto" makes
 * the file harder to recognise, not easier.
 */
export function slugify(value, { maxLength = MAX_SLUG_LENGTH } = {}) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-$/, '');
}

/**
 * A sortable timestamp with no characters a filesystem objects to.
 *
 * `2026-09-08T19-12-55`: ISO order so it sorts and cannot be misread, local
 * wall-clock so it matches the session name and the operator's own clock, and
 * dashes for the colons a time would otherwise carry - illegal on Windows and
 * awkward on macOS.
 */
export function fileTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

/**
 * The generated `MM-DD-YYYY_HH:MM:SS` in the same order as every other
 * timestamp here. Purely a reordering - no timezone conversion - so the
 * instant the name records is the instant the filename shows.
 */
function reorderGeneratedName(sessionName) {
  const [date, time] = String(sessionName).split('_');
  const [month, day, year] = date.split('-');

  return `${year}-${month}-${day}T${time.replace(/:/g, '-')}`;
}

/**
 * The name an export should be saved under.
 *
 * A generated session name is already a timestamp, so it stands alone. An
 * operator's name is joined to one. A run with no name at all still gets a
 * timestamp, so it can never collide with an earlier run the same day.
 */
export function sessionExportFilename(
  prefix,
  sessionName,
  { date, extension = 'json' } = {}
) {
  const trimmed = String(sessionName || '').trim();
  const stamp = fileTimestamp(date);

  if (!trimmed) {
    return `${prefix}-${stamp}.${extension}`;
  }

  if (isGeneratedSessionName(trimmed)) {
    return `${prefix}-${reorderGeneratedName(trimmed)}.${extension}`;
  }

  const slug = slugify(trimmed);

  return slug
    ? `${prefix}-${slug}-${stamp}.${extension}`
    : `${prefix}-${stamp}.${extension}`;
}
