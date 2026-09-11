// Set before the ENV layer resolves, and in its own file for the same reason
// every other MEDIA_ARCHIVE_* case is: `utils/constants.cjs` reads process.env
// once, at require time.
//
// MEDIA_ARCHIVE_ENABLED was a write switch. It is now a retention switch under
// a new name, and a deployment still carrying the old variable set to false
// asked for the least media this service can keep - so that is what it gets,
// rather than a silent flip to keeping everything (#898).
process.env.MEDIA_ARCHIVE_ENABLED = 'false';

const { ENV } = require('../utils/constants.cjs');
const { mediaArchiveSettings } = require('../utils/mediaArchive.cjs');

describe('The retention switch and the name it used to have', () => {
  it('honours MEDIA_ARCHIVE_ENABLED=false as retention off', () => {
    expect(ENV.MEDIA_ARCHIVE_RETAIN).toBe(false);
    expect(mediaArchiveSettings().retain).toBe(false);
  });

  it('still lets the new name win outright', () => {
    expect(mediaArchiveSettings({ retain: true }).retain).toBe(true);
  });
});
