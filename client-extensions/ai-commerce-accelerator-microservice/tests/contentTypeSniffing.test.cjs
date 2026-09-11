const { parseDataUrl, sniffContentType } = require('../utils/misc.cjs');
const mockImage = require('../data/mock-image.json');
const mockPdf = require('../data/mock-pdf.json');

// #928: every default-mode image was archived, packaged and uploaded as
// application/octet-stream while being WebP. Two independent causes - a parser
// that invented a type when none was declared, and a fallback asset that
// declared its type under a key nothing read - so fixing either alone left the
// defect standing.

const bytes = (...values) => Buffer.from(values);

describe('Reading a content type off the bytes', () => {
  it.each([
    [
      'image/webp',
      Buffer.concat([
        bytes(0x52, 0x49, 0x46, 0x46),
        bytes(0, 0, 0, 0),
        bytes(0x57, 0x45, 0x42, 0x50),
      ]),
    ],
    ['image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)],
    ['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['image/gif', bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)],
    ['application/pdf', bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31)],
  ])('recognises %s', (expected, buffer) => {
    expect(sniffContentType(buffer)).toBe(expected);
  });

  it('does not mistake other RIFF containers for WebP', () => {
    // RIFF alone is also WAV and AVI, so both halves of the container are
    // checked rather than the first four bytes.
    const wav = Buffer.concat([
      bytes(0x52, 0x49, 0x46, 0x46),
      bytes(0, 0, 0, 0),
      bytes(0x57, 0x41, 0x56, 0x45),
    ]);

    expect(sniffContentType(wav)).toBeNull();
  });

  it('says nothing rather than guessing at bytes it does not know', () => {
    expect(sniffContentType(Buffer.from('not a known format'))).toBeNull();
    expect(sniffContentType(Buffer.alloc(0))).toBeNull();
    expect(sniffContentType(null)).toBeNull();
  });

  it('reads base64 as readily as a buffer', () => {
    expect(sniffContentType(mockImage.base64)).toBe('image/webp');
    expect(sniffContentType(mockPdf.base64)).toBe('application/pdf');
  });
});

describe('parseDataUrl and the type it reports', () => {
  it('sniffs a bare base64 string, which is how the defect happened', () => {
    // The configured default image is stored with no `data:` prefix, so
    // nothing declared a type and `application/octet-stream` was invented.
    expect(parseDataUrl(mockImage.base64).contentType).toBe('image/webp');
    expect(parseDataUrl(mockPdf.base64).contentType).toBe('application/pdf');
  });

  it('sniffs a data URL that declares no type', () => {
    expect(parseDataUrl(`data:;base64,${mockImage.base64}`).contentType).toBe(
      'image/webp'
    );
  });

  it('believes a declared type over the bytes', () => {
    // A declaration is a statement by whoever stored it; the sniff is for the
    // absence of one, not an override.
    expect(
      parseDataUrl(`data:image/png;base64,${mockImage.base64}`).contentType
    ).toBe('image/png');
  });

  it('falls back only when the bytes are unrecognised', () => {
    const unknown = Buffer.from(
      'some bytes nobody has a signature for'
    ).toString('base64');

    expect(parseDataUrl(unknown).contentType).toBe('application/octet-stream');
    expect(
      parseDataUrl(unknown, { defaultType: 'text/plain' }).contentType
    ).toBe('text/plain');
  });
});

describe('The committed fallback assets', () => {
  it('declare their type under the key their reader uses', () => {
    // They declared `mimeType`; every reader asks for `contentType`, so the
    // declaration was dead and the fallback path produced `undefined`.
    expect(mockImage.contentType).toBe('image/webp');
    expect(mockPdf.contentType).toBe('application/pdf');
    expect(mockImage.mimeType).toBeUndefined();
    expect(mockPdf.mimeType).toBeUndefined();
  });

  it('hold bytes that match what they claim', () => {
    // The claim and the content have to agree, or the rename above would just
    // move the lie to a different key.
    expect(sniffContentType(mockImage.base64)).toBe(mockImage.contentType);
    expect(sniffContentType(mockPdf.base64)).toBe(mockPdf.contentType);
  });
});
