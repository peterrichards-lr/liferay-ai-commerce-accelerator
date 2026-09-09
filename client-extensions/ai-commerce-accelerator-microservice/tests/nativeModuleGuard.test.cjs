const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  binaryArch,
  rebuildReason,
  resolveNativeBinary,
} = require('../scripts/ensure-native-modules.cjs');

/**
 * The fixtures are the prebuilt binaries better-sqlite3 ships for every
 * platform it supports, so the header offsets are checked against real
 * compiler output rather than bytes this test made up. See #793.
 */
const prebuilds = path.join(
  path.dirname(require.resolve('better-sqlite3/package.json')),
  'prebuilds'
);

const otherArch = process.arch === 'x64' ? 'arm64' : 'x64';

function prebuild(name) {
  return path.join(prebuilds, `${name}.node`);
}

function hostPrebuild(arch) {
  return prebuild(
    `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${arch}`
  );
}

let scratch;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-native-'));
});

afterEach(() => {
  fs.rmSync(scratch, { force: true, recursive: true });
});

function placeBinary(relative, source) {
  const target = path.join(scratch, relative);

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);

  return target;
}

describe('binaryArch', () => {
  it('reads the cputype of a 64-bit Mach-O', () => {
    expect(binaryArch(prebuild('darwin-arm64'))).toBe('arm64');
    expect(binaryArch(prebuild('darwin-x64'))).toBe('x64');
  });

  it('reads e_machine of an ELF shared object', () => {
    expect(binaryArch(prebuild('linux-arm64'))).toBe('arm64');
    expect(binaryArch(prebuild('linux-x64'))).toBe('x64');
    expect(binaryArch(prebuild('linuxmusl-arm64'))).toBe('arm64');
    expect(binaryArch(prebuild('linuxmusl-x64'))).toBe('x64');
  });

  it('declines to guess at a format it does not read', () => {
    expect(binaryArch(prebuild('win32-x64'))).toBeNull();
  });

  it('returns null rather than throwing for an unusable file', () => {
    const truncated = path.join(scratch, 'truncated.node');

    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(truncated, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));

    expect(binaryArch(truncated)).toBeNull();
    expect(binaryArch(path.join(scratch, 'absent.node'))).toBeNull();
    expect(binaryArch(scratch)).toBeNull();
  });
});

describe('resolveNativeBinary', () => {
  it('prefers the prebuildify binary, which is what the loader takes first', () => {
    placeBinary(
      path.join('build', 'Release', 'better_sqlite3.node'),
      hostPrebuild(process.arch)
    );

    const expected = placeBinary(
      path.join('prebuilds', `${process.platform}-${process.arch}.node`),
      hostPrebuild(process.arch)
    );

    expect(resolveNativeBinary(scratch)).toBe(expected);
  });

  it('falls back to the node-gyp output', () => {
    const expected = placeBinary(
      path.join('build', 'Release', 'better_sqlite3.node'),
      hostPrebuild(process.arch)
    );

    expect(resolveNativeBinary(scratch)).toBe(expected);
  });

  it('returns null when nothing is compiled', () => {
    expect(resolveNativeBinary(scratch)).toBeNull();
  });
});

describe('rebuildReason', () => {
  it('flags a binary built for another architecture', () => {
    placeBinary(
      path.join('build', 'Release', 'better_sqlite3.node'),
      hostPrebuild(otherArch)
    );

    expect(rebuildReason(scratch)).toContain(`built for ${otherArch}`);
  });

  it('passes a binary built for this architecture', () => {
    placeBinary(
      path.join('build', 'Release', 'better_sqlite3.node'),
      hostPrebuild(process.arch)
    );

    expect(rebuildReason(scratch)).toBeNull();
  });

  it('flags a copy with nothing compiled', () => {
    expect(rebuildReason(scratch)).toBe('no compiled binary present');
  });
});
