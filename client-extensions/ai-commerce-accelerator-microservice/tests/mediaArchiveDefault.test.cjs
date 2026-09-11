const fs = require('fs');
const os = require('os');
const path = require('path');

// Deliberately sets no MEDIA_ARCHIVE_* variables: this is the shipped default,
// and it lives in its own file because `utils/constants.cjs` resolves the ENV
// layer at require time and `tests/mediaArchive.test.cjs` redirects the root.

const { ENV } = require('../utils/constants.cjs');
const { mediaArchiveSettings } = require('../utils/mediaArchive.cjs');

describe('The media archive ships writing, outside the repository', () => {
  it('keeps media beside the database rather than inside the checkout', () => {
    // Asserted on the source, the way tests/databaseLocation.test.cjs asserts
    // where the database goes, and for the same reason: the suite redirects
    // MEDIA_ARCHIVE_PATH at a temporary directory so that a test which opens
    // an archive cannot write into the operator's own media, which means the
    // resolved value in this process is never the shipped one.
    //
    // ./data/media sat next to build/ and dist/, which is the location #869
    // moved the database out of after ordinary tooling destroyed it twice. A
    // package is now built from this directory (#896), so media a `gradle
    // clean` can remove is a promotion that arrives without its pictures.
    const constants = fs.readFileSync(
      path.join(__dirname, '..', 'utils', 'constants.cjs'),
      'utf8'
    );

    expect(constants).toContain("path.join(os.homedir(), '.aica', 'media')");
    expect(constants).not.toContain("MEDIA_ARCHIVE_PATH', './data/media'");
    expect(path.join(os.homedir(), '.aica', 'media')).toContain('.aica');
  });

  it('bounds how long media stays, since nothing else does', () => {
    expect(mediaArchiveSettings()).toMatchObject({
      maxSessions: 10,
      retain: true,
      retentionHours: 72,
    });
  });

  it('has no switch that stops the writing', () => {
    // There used to be one, defaulting to off, because nothing read the
    // directory back (#848). Both producers now stage through it and the
    // package is built by reading it, so a switch that skipped the write would
    // be a switch that silently produced a package with no pictures (#898).
    expect(ENV.MEDIA_ARCHIVE_ENABLED).toBeUndefined();
    expect(ENV.MEDIA_ARCHIVE_RETAIN).toBe(true);
  });

  it('remembers where the media used to live, so it can be moved', () => {
    expect(ENV.MEDIA_ARCHIVE_LEGACY_PATH).toBe('./data/media');
  });
});
