const fs = require('fs');
const path = require('path');
const { BUNDLE_VERSION, KIND } = require('./mediaBundle.cjs');
const { ENV } = require('./constants.cjs');

/**
 * Generated media, written down as it is made.
 *
 * The bytes used to exist for exactly as long as the upload call: the
 * generator held them, posted them and let them go, so a rejected upload cost
 * a picture that had already been paid for and an export had to go back to
 * Liferay for binaries this service had in hand moments earlier (#848).
 *
 * Two properties matter and both come from ordering. The file is written
 * *before* the upload, so a rejection leaves something usable behind rather
 * than a log line; and the manifest is the one `utils/mediaBundle.cjs` already
 * builds, so a package can later be made from the directory by reading the
 * files and handing the entries straight to `buildMediaBundle` - no
 * translation step to drift out of step with the bundle format.
 *
 * This does nothing for a dataset generated before it landed. Those bytes are
 * only in Liferay, and #814's resolution path remains the route to them. Disk
 * when it is there, resolution when it is not.
 */

/**
 * Content type to file extension, deliberately the same table `mediaBundle`
 * uses for its zip entries. It is not exported from there, so it is restated
 * here and `tests/mediaArchive.test.cjs` asserts the two agree by reading the
 * extension back off a real bundle entry - the copy cannot drift silently.
 */
const EXTENSIONS = {
  'application/pdf': 'pdf',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MANIFEST_FILE = 'manifest.json';

/** Bounded so a long-lived instance does not accumulate one entry per run. */
const MAX_OPEN_ARCHIVES = 50;
const openArchives = new Map();

/**
 * Where the media goes, how long it stays, and whether it is written at all.
 *
 * Read at call time rather than captured at module load so a test - or an
 * operator flipping the switch - does not need the module graph rebuilt. The
 * defaults come from the ENV layer alongside `PERSISTENCE_DB_PATH`, which is
 * the precedent for a configurable path the microservice owns on disk.
 */
function mediaArchiveSettings(overrides = {}) {
  return {
    enabled: overrides.enabled ?? ENV.MEDIA_ARCHIVE_ENABLED,
    maxSessions: overrides.maxSessions ?? ENV.MEDIA_ARCHIVE_MAX_SESSIONS,
    retentionHours:
      overrides.retentionHours ?? ENV.MEDIA_ARCHIVE_RETENTION_HOURS,
    root: overrides.root ?? ENV.MEDIA_ARCHIVE_PATH,
  };
}

/**
 * A name that survives a round trip on any platform.
 *
 * Product ERCs and SKUs are model-generated, so they carry spaces, slashes and
 * non-ASCII. Same flattening as the bundle's entry names: the manifest carries
 * the identity, and a name that cannot escape its directory is worth more here
 * than a name that reads well.
 */
function safeSegment(value, fallback = 'unknown') {
  const flattened = String(value ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 60);

  return flattened.replace(/^[.-]+/, '') || fallback;
}

function extensionFor(contentType, kind) {
  return EXTENSIONS[contentType] || (kind === KIND.PDF ? 'pdf' : null) || 'bin';
}

/**
 * The relative path an entry gets, in the layout #848 asked for:
 * `images/<productERC>-<priority>.<ext>` and `pdfs/<productERC>-<sku>.pdf`.
 *
 * `taken` disambiguates rather than letting a second entry overwrite the
 * first: bundle mode can carry several pictures for one product at the same
 * priority, and losing one to a name collision is the quiet loss this whole
 * feature exists to stop.
 */
function entryPath({ contentType, kind, priority, productERC, sku }, taken) {
  const folder = kind === KIND.PDF ? 'pdfs' : 'images';
  const qualifier =
    kind === KIND.PDF
      ? safeSegment(sku, 'sku')
      : safeSegment(priority ?? 1, '1');
  const extension = extensionFor(contentType, kind);
  const base = `${folder}/${safeSegment(productERC)}-${qualifier}`;

  let candidate = `${base}.${extension}`;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}.${extension}`;
    suffix += 1;
  }

  return candidate;
}

/**
 * Drop session directories that are past their welcome.
 *
 * Logs at least rotate; binaries do not, so without this the feature is a slow
 * disk leak on a long-lived instance (#848). Age first - the point is that a
 * run stays recoverable for a while and then does not - with a count cap
 * behind it, because a single busy day can fill a volume well inside the
 * retention window. The current session is never a candidate.
 */
function pruneArchiveRoot(root, { keep, logger, maxSessions, retentionHours }) {
  let entries;

  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    // Nothing there yet, or nothing readable. Either way there is nothing to
    // prune and the caller is about to find out for itself.
    return { removed: [] };
  }

  const sessions = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === keep) continue;

    const dir = path.join(root, entry.name);

    try {
      sessions.push({ dir, modifiedAt: fs.statSync(dir).mtimeMs });
    } catch {
      // Vanished under us - a concurrent prune, most likely. Not our problem.
    }
  }

  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
  const doomed = new Set(
    sessions.filter((s) => s.modifiedAt < cutoff).map((s) => s.dir)
  );

  const survivors = sessions
    .filter((s) => !doomed.has(s.dir))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  // `keep` is not in `sessions`, so it is counted here rather than left to
  // push an otherwise-fine directory over the cap.
  survivors
    .slice(Math.max(0, maxSessions - 1))
    .forEach((s) => doomed.add(s.dir));

  const removed = [];

  for (const dir of doomed) {
    try {
      fs.rmSync(dir, { force: true, recursive: true });
      removed.push(dir);
    } catch (error) {
      logger?.warn?.(
        `Could not prune the media archive directory ${dir}: ${error.message}`
      );
    }
  }

  return { removed };
}

/**
 * The archive for one session.
 *
 * Every method swallows its own failures. Media is decoration and the run has
 * already paid for the model call, so a full disk must not cost the catalogue
 * - but it must not be silent either, so the first failure is reported at
 * error level, the entry is recorded as `unresolved` for whoever reads the
 * manifest, and the archive then stands down for the rest of the session
 * rather than logging once per picture.
 */
class MediaArchive {
  constructor({ correlationId, dir, logger, sessionId }) {
    this.correlationId = correlationId || '∅';
    this.dir = dir;
    this.logger = logger;
    this.sessionId = sessionId;
    this.taken = new Set();
    this.manifest = {
      counts: { images: 0, pdfs: 0, unresolved: 0 },
      files: [],
      unresolved: [],
      version: BUNDLE_VERSION,
    };
    this.standDown = false;
    this.loadManifest();
  }

  /**
   * A session can be written to twice - images and PDFs are separate passes,
   * and a media-only re-run comes back to the same directory - so an existing
   * manifest is extended rather than replaced.
   */
  loadManifest() {
    try {
      const existing = JSON.parse(
        fs.readFileSync(path.join(this.dir, MANIFEST_FILE), 'utf8')
      );

      this.manifest.files = Array.isArray(existing.files) ? existing.files : [];
      this.manifest.unresolved = Array.isArray(existing.unresolved)
        ? existing.unresolved
        : [];
      this.manifest.files.forEach((file) => this.taken.add(file.file));
      this.recount();
    } catch {
      // No manifest, or one that is not readable JSON. Starting clean loses
      // nothing that was not already lost.
    }
  }

  recount() {
    this.manifest.counts = {
      images: this.manifest.files.filter((f) => f.kind === KIND.IMAGE).length,
      pdfs: this.manifest.files.filter((f) => f.kind === KIND.PDF).length,
      unresolved: this.manifest.unresolved.length,
    };
  }

  report(message, error) {
    if (this.standDown) return;

    this.standDown = true;
    this.logger?.error?.(
      `${message}: ${error.message}. Media for session ${this.sessionId} will not be written to disk for the rest of this run; the run continues.`,
      {
        correlationId: this.correlationId,
        error: error.message,
        sessionId: this.sessionId,
      }
    );
  }

  writeManifest() {
    this.recount();

    try {
      fs.writeFileSync(
        path.join(this.dir, MANIFEST_FILE),
        JSON.stringify(this.manifest, null, 2)
      );
    } catch (error) {
      this.report('Could not write the media manifest', error);
    }
  }

  /**
   * Write one binary and record it. Called *before* the upload, deliberately.
   *
   * Returns the manifest entry so the caller can hand back what Liferay
   * answered with, or null when nothing was written - the caller has an upload
   * to get on with either way.
   */
  record({
    base64,
    buffer,
    contentType,
    kind,
    priority,
    productERC,
    sku,
    title,
  }) {
    if (this.standDown) return null;

    const bytes = Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(String(base64 || ''), 'base64');

    const entry = {
      contentType: contentType || null,
      kind,
      priority: priority ?? 1,
      productERC,
      title: title ?? null,
    };

    if (bytes.length === 0) {
      this.manifest.unresolved.push({
        ...entry,
        reason: 'no content to write',
      });
      this.writeManifest();
      return null;
    }

    const file = entryPath({ ...entry, sku }, this.taken);

    try {
      const target = path.join(this.dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    } catch (error) {
      this.report(
        `Could not write the ${kind} for ${productERC} to the media archive`,
        error
      );
      this.manifest.unresolved.push({ ...entry, reason: error.message });
      this.writeManifest();
      return null;
    }

    this.taken.add(file);
    const recorded = { ...entry, file };
    this.manifest.files.push(recorded);
    this.writeManifest();

    return recorded;
  }

  /**
   * Attach the reference the upload answered with.
   *
   * `attachmentERC` and `src` are what let a later export point at the copy
   * Liferay holds without hunting for it product by product (#838). They only
   * exist once the upload has been accepted, which is after the bytes are
   * already down - so they are added to an entry that is already on disk.
   */
  link(entry, reference) {
    if (!entry || !reference) return;

    const fields = {};
    if (reference.attachmentERC) fields.attachmentERC = reference.attachmentERC;
    if (reference.src) fields.src = reference.src;

    if (Object.keys(fields).length === 0) return;

    Object.assign(entry, fields);
    this.writeManifest();
  }
}

/**
 * An archive that is switched off, or could not be opened.
 *
 * A null return would put `if (archive)` at every call site; this keeps the
 * generator reading as though the archive is always there, which is the point
 * - the upload is what matters and the archive is a side effect of it.
 */
const NO_ARCHIVE = {
  dir: null,
  enabled: false,
  link: () => {},
  record: () => null,
};

/**
 * Open - and create - the directory for a session's media.
 *
 * Never throws. A media archive that could take the run down with it would be
 * a worse trade than the one it replaces.
 */
function openMediaArchive({ correlationId, logger, sessionId, ...overrides }) {
  const settings = mediaArchiveSettings(overrides);

  if (!settings.enabled || !sessionId) return NO_ARCHIVE;

  const cached = openArchives.get(sessionId);
  if (cached) return cached;

  const dir = path.join(settings.root, safeSegment(sessionId, 'session'));

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    logger?.error?.(
      `Could not create the media archive directory ${dir}: ${error.message}. Generated media will not be written to disk; the run continues.`,
      { correlationId, error: error.message, sessionId }
    );
    return NO_ARCHIVE;
  }

  pruneArchiveRoot(settings.root, {
    keep: path.basename(dir),
    logger,
    maxSessions: settings.maxSessions,
    retentionHours: settings.retentionHours,
  });

  const archive = new MediaArchive({ correlationId, dir, logger, sessionId });
  archive.enabled = true;

  if (openArchives.size >= MAX_OPEN_ARCHIVES) {
    openArchives.delete(openArchives.keys().next().value);
  }
  openArchives.set(sessionId, archive);

  return archive;
}

/**
 * Everything a session's archive directory holds, ready for `buildMediaBundle`.
 *
 * The manifest is the authority, not the directory listing, for the same
 * reason the import trusts the bundle's manifest over its entries (#878): the
 * manifest carries the identity - product, kind, title, priority, content type
 * - and a file on its own carries only a name. An entry naming a file that is
 * no longer there is returned in `missing` rather than skipped, because a
 * package that is quietly short is the failure this feature exists to prevent.
 *
 * Returns `null` when the archive is switched off or the session was never
 * written, which the caller must be able to tell apart from a session that
 * genuinely generated no media. The first cannot produce a package and has to
 * say so; the second produces an honest empty one.
 */
function readMediaArchive({ sessionId, ...overrides } = {}) {
  const settings = mediaArchiveSettings(overrides);

  if (!settings.enabled || !sessionId) return null;

  const dir = path.join(settings.root, safeSegment(sessionId, 'session'));

  let manifest;

  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')
    );
  } catch {
    return null;
  }

  const entries = [];
  const missing = [];

  for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
    const target = path.resolve(dir, String(file.file || ''));

    // The writer flattens every name, so a manifest that points outside its
    // own session directory was not written by this service. Treating it as
    // missing rather than reading it keeps a package built from a tampered or
    // hand-edited archive to the bytes that archive actually owns.
    if (
      target !== dir &&
      !target.startsWith(`${path.resolve(dir)}${path.sep}`)
    ) {
      missing.push({
        ...file,
        reason: 'the manifest names a file outside the session directory',
      });
      continue;
    }

    let buffer;

    try {
      buffer = fs.readFileSync(target);
    } catch (error) {
      // The code, not the message: the message carries the absolute path,
      // and this reason travels inside a package that goes to other people.
      missing.push({
        ...file,
        reason:
          error.code === 'ENOENT'
            ? `the media archive no longer holds ${file.file}`
            : `${file.file} could not be read from the media archive (${error.code || 'unknown error'})`,
      });
      continue;
    }

    entries.push({ ...file, buffer });
  }

  return {
    dir,
    entries,
    manifest: {
      counts: manifest.counts || null,
      unresolved: Array.isArray(manifest.unresolved) ? manifest.unresolved : [],
      version: manifest.version ?? null,
    },
    missing,
  };
}

/** Test seam: the open-archive cache is process-wide and outlives a test. */
function resetMediaArchives() {
  openArchives.clear();
}

module.exports = {
  EXTENSIONS,
  MANIFEST_FILE,
  NO_ARCHIVE,
  mediaArchiveSettings,
  openMediaArchive,
  pruneArchiveRoot,
  readMediaArchive,
  resetMediaArchives,
};
