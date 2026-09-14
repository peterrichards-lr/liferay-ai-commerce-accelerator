const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const StreamZip = require('node-stream-zip');

/**
 * The dataset export, plus the binaries its media entries point at.
 *
 * A generated dataset is worth paying for once - the AI calls happen on the
 * first run and every instance after that is a replay - but media never came
 * along, so a replayed catalogue had products and no pictures (#676). That was
 * accepted while media was decoration. It stopped being decoration when a demo
 * rehearsed on one instance had to be presented from another: same products,
 * different pictures is not the same dataset (#814).
 *
 * The binaries are not stored anywhere between runs. `createdImages` records
 * `productERC` and `title` and no bytes, which is deliberate - no file content
 * in the database - and it is enough, because those two locate the attachment
 * in Liferay at export time. The bundle is built from the source instance and
 * consumed by the target; nothing persists it in between.
 */
/**
 * The package's own extension.
 *
 * It is a zip and stays one - the import reads `media/manifest.json` before
 * anything else, which a solid archive could not offer - but a `.zip` in a
 * downloads folder invites being opened, rearranged and re-zipped. The
 * manifest names every entry, its product, title, priority and content type,
 * and the import trusts it over the directory, so a package whose files and
 * manifest disagree imports quietly wrong (#878).
 *
 * Nothing dispatches on this. `looksLikeZip` reads the local file header, so a
 * renamed package still imports - which it must, because someone will rename
 * one to look inside.
 */
const PACKAGE_EXTENSION = 'aicap';

const DATASET_ENTRY = 'dataset.json';
const MANIFEST_ENTRY = 'media/manifest.json';
const BUNDLE_VERSION = 1;

const KIND = { IMAGE: 'image', PDF: 'pdf' };

/**
 * Which directory a binary goes in, in the package and in the archive alike.
 *
 * Two buckets rather than one per kind, and the second one is named for what
 * it will hold rather than for what it holds today. PDFs are what generation
 * produces now; CAD models, high-resolution renders and 3D/AR assets are the
 * kind of thing that arrives next, and none of them wants a directory called
 * `pdfs` - nor a directory of its own, since the manifest already carries the
 * kind and the tool keeps its own separation from it.
 *
 * Keyed on "is it a picture" rather than "is it a PDF", so a kind added later
 * lands in `attachments` without this needing to be edited again.
 *
 * Packages written before this named their entries `media/pdfs/...`. Nothing
 * translates them and nothing needs to: both readers resolve a file by the
 * path its own manifest gives, never by rebuilding the directory name.
 */
const MEDIA_FOLDERS = Object.freeze({
  ATTACHMENTS: 'attachments',
  IMAGES: 'images',
});

function mediaFolder(kind) {
  return kind === KIND.IMAGE ? MEDIA_FOLDERS.IMAGES : MEDIA_FOLDERS.ATTACHMENTS;
}

const EXTENSIONS = {
  'application/pdf': 'pdf',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * A file name that survives a round trip through a zip on any platform.
 *
 * Product ERCs and titles are model-generated, so they carry spaces, slashes
 * and non-ASCII. The entry name is an index plus a flattened ERC rather than
 * anything meaningful: the manifest carries the identity, and a name that
 * cannot collide is worth more here than a name that reads well.
 */
function entryName(kind, index, productERC, contentType) {
  const safe = String(productERC || 'unknown')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .slice(0, 60);
  const extension = EXTENSIONS[contentType] || 'bin';

  return `media/${mediaFolder(kind)}/${String(index).padStart(4, '0')}-${safe}.${extension}`;
}

/**
 * Packs a dataset and its resolved media into a zip.
 *
 * `media` is `[{ kind, productERC, title, contentType, priority, buffer? ,
 * path? }]`. `path` is how every real caller supplies a binary now: the
 * archive on disk (`utils/mediaArchive.cjs`) and the export routes both hand
 * over a file location rather than its bytes, and the entry is added to the
 * zip as a read stream instead of a `Buffer` - for a catalogue with hundreds
 * of megabytes of media, holding every one of them in memory at once just to
 * copy them into the zip was the whole of #877. `buffer` still works, for a
 * caller that only ever had the bytes in hand (a test fixture, a small
 * in-memory dataset asset) - this is which route is cheaper, not a
 * requirement that every caller change.
 *
 * An entry whose content cannot be found - no buffer, no path, or a path that
 * no longer resolves to a file - is recorded in `manifest.unresolved` rather
 * than dropped: an export that quietly carries fewer pictures than the source
 * is the failure this feature exists to prevent, and it must be visible in the
 * artefact itself rather than only in a log the importer never sees.
 */
async function buildMediaBundle({ dataset, media = [] }) {
  const zip = new JSZip();
  const files = [];
  const unresolved = [];

  media.forEach((item, index) => {
    const base = {
      contentType: item.contentType || null,
      kind: item.kind,
      priority: item.priority ?? 1,
      productERC: item.productERC,
      title: item.title ?? null,
    };

    const hasBuffer = Buffer.isBuffer(item.buffer) && item.buffer.length > 0;
    const hasPath = typeof item.path === 'string' && item.path.length > 0;

    if (hasPath && !fs.existsSync(item.path)) {
      unresolved.push({
        ...base,
        reason: 'the file this entry pointed at is no longer on disk',
      });
      return;
    }

    if (!hasBuffer && !hasPath) {
      unresolved.push({
        ...base,
        reason: item.reason || 'no content resolved',
      });
      return;
    }

    const file = entryName(item.kind, index, item.productERC, item.contentType);
    zip.file(file, hasPath ? fs.createReadStream(item.path) : item.buffer);
    files.push({ ...base, file });
  });

  const manifest = {
    counts: {
      images: files.filter((file) => file.kind === KIND.IMAGE).length,
      pdfs: files.filter((file) => file.kind === KIND.PDF).length,
      unresolved: unresolved.length,
    },
    files,
    unresolved,
    version: BUNDLE_VERSION,
  };

  zip.file(DATASET_ENTRY, JSON.stringify(dataset, null, 2));
  zip.file(MANIFEST_ENTRY, JSON.stringify(manifest, null, 2));

  return {
    manifest,
    // `streamFiles: true` is what makes the read streams above actually pay
    // off: JSZip compresses and emits each entry as it is read rather than
    // waiting to hold every one of them before producing anything. A caller
    // that still wants one `Buffer` can drain this itself - the difference
    // is that doing so is now the caller's choice to hold the whole payload
    // in memory, not this function's.
    stream: zip.generateNodeStream({
      compression: 'DEFLATE',
      streamFiles: true,
      type: 'nodebuffer',
    }),
  };
}

/** A zip's local file header. Cheaper and surer than trusting a file name. */
function looksLikeZip(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length > 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  );
}

const ENTRY_NOT_FOUND = 'Entry not found';

/**
 * A JSON entry from the archive, or `undefined` when the archive holds none
 * by that name. Any other failure - a corrupt entry, a truncated archive -
 * is left to propagate, the same as a `.file()` lookup that found something
 * unreadable used to.
 */
async function readJsonEntry(zip, name) {
  let data;

  try {
    data = await zip.entryData(name);
  } catch (error) {
    if (error.message === ENTRY_NOT_FOUND) return undefined;
    throw error;
  }

  return JSON.parse(data.toString('utf8'));
}

/**
 * Unpacks a bundle into the dataset and the media the importer can attach.
 *
 * The upload is written to a temporary file and read back from there with
 * `node-stream-zip` rather than parsed with `JSZip.loadAsync(buffer)` - which
 * held the whole archive a second time, as its own parsed copy, for as long
 * as the read took (#877). `node-stream-zip` opens by path and never holds
 * more than the entry it was asked for, which is what "read entries from it"
 * means here: the temporary file is the archive for the rest of this call,
 * not a buffer standing in for it.
 *
 * A manifest entry naming a file the zip does not contain is reported rather
 * than skipped, for the same reason the export records what it could not
 * resolve: the whole point is that the target ends up with the same pictures,
 * and "some of them" must not read as success.
 */
async function readMediaBundle(buffer) {
  const stagingDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'aica-import-bundle-')
  );
  const archivePath = path.join(stagingDir, 'upload.zip');

  try {
    fs.writeFileSync(archivePath, buffer);

    const zip = new StreamZip.async({ file: archivePath });

    try {
      const dataset = await readJsonEntry(zip, DATASET_ENTRY);

      if (dataset === undefined) {
        throw new Error(
          `Not an AICA dataset bundle: no ${DATASET_ENTRY} inside the archive`
        );
      }

      const manifest = (await readJsonEntry(zip, MANIFEST_ENTRY)) ?? {
        files: [],
        unresolved: [],
        version: null,
      };

      const media = [];
      const missing = [];

      for (const entry of manifest.files || []) {
        let content;

        try {
          content = await zip.entryData(entry.file);
        } catch (error) {
          if (error.message !== ENTRY_NOT_FOUND) throw error;
          missing.push(entry);
          continue;
        }

        media.push({
          contentType: entry.contentType,
          kind: entry.kind,
          priority: entry.priority,
          productERC: entry.productERC,
          title: entry.title,
          buffer: content,
        });
      }

      return { dataset, manifest, media, missing };
    } finally {
      // A close failure here is an echo of whatever already went wrong above
      // - the file is about to be deleted either way - so it must not
      // replace the error this call is actually failing with.
      await zip.close().catch(() => {});
    }
  } finally {
    fs.rmSync(stagingDir, { force: true, recursive: true });
  }
}

module.exports = {
  BUNDLE_VERSION,
  PACKAGE_EXTENSION,
  DATASET_ENTRY,
  KIND,
  MEDIA_FOLDERS,
  mediaFolder,
  MANIFEST_ENTRY,
  buildMediaBundle,
  looksLikeZip,
  readMediaBundle,
};
