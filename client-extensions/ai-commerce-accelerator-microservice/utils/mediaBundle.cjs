const JSZip = require('jszip');

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
  const folder = kind === KIND.PDF ? 'pdfs' : 'images';

  return `media/${folder}/${String(index).padStart(4, '0')}-${safe}.${extension}`;
}

/**
 * Packs a dataset and its resolved media into a zip.
 *
 * `media` is `[{ kind, productERC, title, contentType, priority, buffer }]`.
 * An entry whose buffer is missing is recorded in `manifest.unresolved` rather
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

    if (!item.buffer || item.buffer.length === 0) {
      unresolved.push({
        ...base,
        reason: item.reason || 'no content resolved',
      });
      return;
    }

    const file = entryName(item.kind, index, item.productERC, item.contentType);
    zip.file(file, item.buffer);
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
    buffer: await zip.generateAsync({
      compression: 'DEFLATE',
      type: 'nodebuffer',
    }),
    manifest,
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

/**
 * Unpacks a bundle into the dataset and the media the importer can attach.
 *
 * A manifest entry naming a file the zip does not contain is reported rather
 * than skipped, for the same reason the export records what it could not
 * resolve: the whole point is that the target ends up with the same pictures,
 * and "some of them" must not read as success.
 */
async function readMediaBundle(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const datasetEntry = zip.file(DATASET_ENTRY);
  if (!datasetEntry) {
    throw new Error(
      `Not an AICA dataset bundle: no ${DATASET_ENTRY} inside the archive`
    );
  }

  const dataset = JSON.parse(await datasetEntry.async('string'));

  const manifestEntry = zip.file(MANIFEST_ENTRY);
  const manifest = manifestEntry
    ? JSON.parse(await manifestEntry.async('string'))
    : { files: [], unresolved: [], version: null };

  const media = [];
  const missing = [];

  for (const entry of manifest.files || []) {
    const file = zip.file(entry.file);

    if (!file) {
      missing.push(entry);
      continue;
    }

    media.push({
      contentType: entry.contentType,
      kind: entry.kind,
      priority: entry.priority,
      productERC: entry.productERC,
      title: entry.title,
      buffer: await file.async('nodebuffer'),
    });
  }

  return { dataset, manifest, media, missing };
}

module.exports = {
  BUNDLE_VERSION,
  PACKAGE_EXTENSION,
  DATASET_ENTRY,
  KIND,
  MANIFEST_ENTRY,
  buildMediaBundle,
  looksLikeZip,
  readMediaBundle,
};
