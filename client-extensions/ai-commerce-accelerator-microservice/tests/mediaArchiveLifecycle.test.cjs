const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-media-lifecycle-'));
process.env.MEDIA_ARCHIVE_PATH = ROOT;

const { KIND } = require('../utils/mediaBundle.cjs');
const {
  EXTRACT_STAGING_PREFIX,
  MANIFEST_FILE,
  extractStagingId,
  migrateLegacyMediaRoot,
  openMediaArchive,
  readMediaArchive,
  removeMediaArchive,
  resetMediaArchives,
  sweepOrphanMediaArchives,
} = require('../utils/mediaArchive.cjs');

// #898: one media root, written by both producers, swept when its session
// goes. These cover what that costs if it is got wrong - a package carrying
// every picture twice, and a directory nothing ever deletes.

const PRODUCT = 'AICA-PRD-HELMET';

function archiveFor(sessionId) {
  return openMediaArchive({ logger: null, root: ROOT, sessionId });
}

function image(bytes, title = 'helmet.webp') {
  return {
    buffer: Buffer.from(bytes),
    contentType: 'image/webp',
    kind: KIND.IMAGE,
    priority: 1,
    productERC: PRODUCT,
    title,
  };
}

afterEach(() => {
  resetMediaArchives();
  for (const entry of fs.readdirSync(ROOT)) {
    fs.rmSync(path.join(ROOT, entry), { force: true, recursive: true });
  }
});

describe('Recording the same media twice', () => {
  it('replaces rather than keeping both', () => {
    const archive = archiveFor('session-replace');

    archive.record(image('first'));
    archive.record(image('second'));

    const read = readMediaArchive({ root: ROOT, sessionId: 'session-replace' });

    // entryPath resolves a name collision by appending -2, so without this a
    // second extract of the same session would put every picture in the
    // package twice and the counts would read as a catalogue with twice the
    // media it has.
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0].buffer.toString()).toBe('second');
    expect(
      fs.readdirSync(path.join(ROOT, 'session-replace', 'images'))
    ).toHaveLength(1);
  });

  it('treats a different picture of the same product as different', () => {
    const archive = archiveFor('session-two');

    archive.record(image('front', 'front.webp'));
    archive.record(image('back', 'back.webp'));

    expect(
      readMediaArchive({ root: ROOT, sessionId: 'session-two' }).entries
    ).toHaveLength(2);
  });

  it('clears an earlier failure when the retry succeeds', () => {
    const archive = archiveFor('session-retry');

    archive.record({ ...image(''), buffer: Buffer.alloc(0), reason: '403' });
    archive.record(image('second time'));

    const read = readMediaArchive({ root: ROOT, sessionId: 'session-retry' });

    expect(read.entries).toHaveLength(1);
    expect(read.manifest.unresolved).toEqual([]);
  });

  it('keeps the reason the caller gave for an unresolved item', () => {
    const archive = archiveFor('session-reason');

    archive.record({
      ...image(''),
      buffer: Buffer.alloc(0),
      reason: 'content fetch failed: 403',
    });

    const { manifest } = readMediaArchive({
      root: ROOT,
      sessionId: 'session-reason',
    });

    expect(manifest.unresolved[0].reason).toBe('content fetch failed: 403');
  });
});

describe('Sweeping media whose session has gone', () => {
  it('removes a directory with no session and keeps one that has', () => {
    archiveFor('session-alive').record(image('alive'));
    archiveFor('session-dead').record(image('dead'));

    const { removed } = sweepOrphanMediaArchives({
      knownSessionIds: ['session-alive'],
      root: ROOT,
    });

    expect(removed).toHaveLength(1);
    expect(fs.existsSync(path.join(ROOT, 'session-alive'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'session-dead'))).toBe(false);
  });

  it('leaves extract staging alone, since having no session is what it is', () => {
    const staging = extractStagingId();

    archiveFor(staging).record(image('staged'));

    sweepOrphanMediaArchives({ knownSessionIds: [], root: ROOT });

    expect(staging.startsWith(EXTRACT_STAGING_PREFIX)).toBe(true);
    expect(fs.existsSync(path.join(ROOT, staging))).toBe(true);
  });

  it('does nothing at all when the root does not exist yet', () => {
    expect(
      sweepOrphanMediaArchives({
        knownSessionIds: [],
        root: path.join(ROOT, 'not-created'),
      })
    ).toEqual({ removed: [] });
  });
});

describe('Removing one directory', () => {
  it('deletes it and forgets the open archive', () => {
    archiveFor('session-scratch').record(image('scratch'));

    expect(
      removeMediaArchive({ root: ROOT, sessionId: 'session-scratch' })
    ).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'session-scratch'))).toBe(false);

    // The cache is process-wide, so a stale entry would hand the next caller
    // an archive pointing at a directory that is no longer there.
    archiveFor('session-scratch').record(image('again'));

    expect(
      readMediaArchive({ root: ROOT, sessionId: 'session-scratch' }).entries
    ).toHaveLength(1);
  });
});

describe('Media left at the old in-repository path', () => {
  const legacyBase = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-legacy-'));

  function legacyWithMedia(name) {
    const legacy = path.join(legacyBase, name);
    fs.mkdirSync(path.join(legacy, 'session-old', 'images'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(legacy, 'session-old', MANIFEST_FILE),
      JSON.stringify({ files: [], unresolved: [], version: 1 })
    );
    return legacy;
  }

  it('is moved rather than ignored', () => {
    const legacy = legacyWithMedia('move');
    const destination = path.join(legacyBase, 'moved-root');
    const configured = process.env.MEDIA_ARCHIVE_PATH;
    delete process.env.MEDIA_ARCHIVE_PATH;

    try {
      const result = migrateLegacyMediaRoot({
        legacyRoot: legacy,
        root: destination,
      });

      expect(result.moved).toBe(true);
      expect(fs.existsSync(path.join(destination, 'session-old'))).toBe(true);
      expect(fs.existsSync(legacy)).toBe(false);
    } finally {
      process.env.MEDIA_ARCHIVE_PATH = configured;
    }
  });

  it('is left alone when the operator set a path of their own', () => {
    const legacy = legacyWithMedia('configured');

    // MEDIA_ARCHIVE_PATH is set by the suite, which is exactly the case: a
    // deployment that named a directory gets that directory, not a migration
    // it never asked for.
    expect(
      migrateLegacyMediaRoot({
        legacyRoot: legacy,
        root: path.join(legacyBase, 'never-used'),
      }).moved
    ).toBe(false);
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it('will not merge into a destination that already exists', () => {
    const legacy = legacyWithMedia('both');
    const destination = path.join(legacyBase, 'existing-root');
    fs.mkdirSync(destination, { recursive: true });
    const configured = process.env.MEDIA_ARCHIVE_PATH;
    delete process.env.MEDIA_ARCHIVE_PATH;
    const warnings = [];

    try {
      const result = migrateLegacyMediaRoot({
        legacyRoot: legacy,
        logger: { warn: (message) => warnings.push(message) },
        root: destination,
      });

      // Silently merging two archives would mean a manifest from one root and
      // files from another, which reads as a package missing half its media.
      expect(result.moved).toBe(false);
      expect(warnings[0]).toContain('by hand');
      expect(fs.existsSync(legacy)).toBe(true);
    } finally {
      process.env.MEDIA_ARCHIVE_PATH = configured;
    }
  });
});
