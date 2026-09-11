const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-media-folders-'));
process.env.MEDIA_ARCHIVE_PATH = ROOT;

const {
  DATASET_ENTRY,
  KIND,
  MANIFEST_ENTRY,
  MEDIA_FOLDERS,
  mediaFolder,
  readMediaBundle,
} = require('../utils/mediaBundle.cjs');
const {
  MANIFEST_FILE,
  openMediaArchive,
  readMediaArchive,
} = require('../utils/mediaArchive.cjs');

// #901: the directory was named for the one format generation produces today.
// The manifest carries the kind and the tool keeps its own separation from it,
// so the directory only has to be a place - and the next format to arrive will
// not be a PDF.

describe('Where a binary is filed', () => {
  it('puts pictures in images and everything else in attachments', () => {
    expect(mediaFolder(KIND.IMAGE)).toBe(MEDIA_FOLDERS.IMAGES);
    expect(mediaFolder(KIND.PDF)).toBe(MEDIA_FOLDERS.ATTACHMENTS);
  });

  it('files a kind nobody has added yet as an attachment', () => {
    // Keyed on "is it a picture" rather than "is it a PDF", so a CAD model or
    // a 3D asset lands somewhere sensible without this being edited again.
    expect(mediaFolder('cad-model')).toBe(MEDIA_FOLDERS.ATTACHMENTS);
    expect(mediaFolder(undefined)).toBe(MEDIA_FOLDERS.ATTACHMENTS);
  });

  it('writes the archive and the package with the same two directories', async () => {
    const archive = openMediaArchive({ root: ROOT, sessionId: 'folders' });

    const image = archive.record({
      buffer: Buffer.from('picture'),
      contentType: 'image/webp',
      kind: KIND.IMAGE,
      priority: 1,
      productERC: 'P1',
    });
    const attachment = archive.record({
      buffer: Buffer.from('datasheet'),
      contentType: 'application/pdf',
      kind: KIND.PDF,
      productERC: 'P1',
      sku: 'P1-SKU',
    });

    expect(image.file).toBe('images/P1-1.webp');
    expect(attachment.file).toBe('attachments/P1-P1-SKU.pdf');
  });
});

describe('An archive written before the rename', () => {
  it('still reads, because the manifest names the path', () => {
    const dir = path.join(ROOT, 'legacy-archive');
    fs.mkdirSync(path.join(dir, 'pdfs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pdfs', 'P1-P1-SKU.pdf'), 'old bytes');
    fs.writeFileSync(
      path.join(dir, MANIFEST_FILE),
      JSON.stringify({
        files: [
          {
            contentType: 'application/pdf',
            file: 'pdfs/P1-P1-SKU.pdf',
            kind: KIND.PDF,
            priority: 1,
            productERC: 'P1',
            title: null,
          },
        ],
        unresolved: [],
        version: 1,
      })
    );

    const read = readMediaArchive({ root: ROOT, sessionId: 'legacy-archive' });

    expect(read.missing).toEqual([]);
    expect(read.entries[0].buffer.toString()).toBe('old bytes');
  });
});

describe('A package written before the rename', () => {
  it('still imports, so an existing .aicap is not stranded', async () => {
    const zip = new JSZip();

    zip.file(DATASET_ENTRY, JSON.stringify({ products: [] }));
    zip.file('media/pdfs/0000-P1.pdf', Buffer.from('old package bytes'));
    zip.file(
      MANIFEST_ENTRY,
      JSON.stringify({
        counts: { images: 0, pdfs: 1, unresolved: 0 },
        files: [
          {
            contentType: 'application/pdf',
            file: 'media/pdfs/0000-P1.pdf',
            kind: KIND.PDF,
            priority: 1,
            productERC: 'P1',
            title: null,
          },
        ],
        unresolved: [],
        version: 1,
      })
    );

    const bundle = await readMediaBundle(
      await zip.generateAsync({ type: 'nodebuffer' })
    );

    // The 30MB package the prd promotion was built from carries these paths.
    // Nothing translates them and nothing needs to.
    expect(bundle.missing).toEqual([]);
    expect(bundle.media[0].buffer.toString()).toBe('old package bytes');
  });
});
