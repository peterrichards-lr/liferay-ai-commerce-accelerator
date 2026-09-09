/**
 * ensure-native-modules.cjs
 *
 * Automatically detects if native modules (better-sqlite3) are incompatible
 * with the current Node.js runtime and recompiles them if necessary.
 *
 * This prevents the common 'NODE_MODULE_VERSION' mismatch error when
 * switching between developer environments and Gradle build environments.
 *
 * There is more than one copy to check. yarn hoists better-sqlite3 to the
 * workspace root, but @liferay/accelerator-sdk carries its own nested copy,
 * and the SDK's persistence worker loads that one. Probing only the copy this
 * script can `require` reported everything healthy while seventeen tests
 * failed with "Could not locate the bindings file" pointing straight at the
 * nested path. See #638.
 *
 * Detection reads the binary's own header rather than trying to load it,
 * because a wrong-architecture .node cannot be caught with try/catch: dlopen
 * on a Mach-O of the wrong cputype aborts the process, so there is no
 * exception to receive. Under `yarn test` that abort is reported as SIGKILL
 * against the pretest line, which blames this script instead of the module.
 * Inspecting the header is deterministic, cannot crash, and judges the exact
 * file that will be loaded rather than whatever the loader happens to resolve
 * from somewhere else in the tree. See #793.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Mach-O 64-bit little-endian: magic 0xfeedfacf at offset 0, cputype at
 * offset 4. ELF: magic 0x7f 'E' 'L' 'F' at offset 0, e_machine at offset 18.
 * Verified against the prebuilt binaries better-sqlite3 ships for every
 * platform it supports, cross-checked with file(1).
 */
const MACHO_MAGIC_64_LE = 0xfeedfacf;
const ELF_MAGIC = 0x7f454c46;

const MACHO_CPU_TYPES = new Map([
  [0x0100000c, 'arm64'],
  [0x01000007, 'x64'],
]);

const ELF_MACHINES = new Map([
  [0xb7, 'arm64'],
  [0x3e, 'x64'],
]);

/** e_machine ends at offset 20, the furthest field either format needs. */
const HEADER_BYTES = 20;

/**
 * The architecture a compiled addon was built for, as a `process.arch` value,
 * or null when the format is not one we can read. Unknown is deliberately not
 * "wrong": a universal Mach-O or a Windows DLL is none of our business, and
 * rebuilding on a verdict we cannot justify would be worse than skipping it.
 */
function binaryArch(file) {
  let header;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const fd = fs.openSync(file, 'r');

    try {
      header = Buffer.alloc(HEADER_BYTES);

      const read = fs.readSync(fd, header, 0, HEADER_BYTES, 0);

      if (read < HEADER_BYTES) {
        return null;
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }

  if (header.readUInt32LE(0) === MACHO_MAGIC_64_LE) {
    return MACHO_CPU_TYPES.get(header.readUInt32LE(4)) || null;
  }

  if (header.readUInt32BE(0) === ELF_MAGIC) {
    return ELF_MACHINES.get(header.readUInt16LE(18)) || null;
  }

  return null;
}

/**
 * The compiled binary a given better-sqlite3 copy will actually load, in the
 * order its own loader searches. v13 resolves a prebuildify binary from
 * prebuilds/ and only falls back to the node-gyp output; v12 goes through
 * `bindings`, which never looks at prebuilds. Taking the first that exists
 * therefore matches both, because only one of the two layouts is ever present
 * in a single copy.
 */
function resolveNativeBinary(pkgDir) {
  const candidates = [
    path.join(pkgDir, 'prebuilds', `${process.platform}-${process.arch}.node`),
    path.join(pkgDir, 'prebuilds', `linuxmusl-${process.arch}.node`),
    path.join(pkgDir, 'build', 'Debug', 'better_sqlite3.node'),
    path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node'),
  ];

  return (
    candidates.find((candidate) =>
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.existsSync(candidate)
    ) || null
  );
}

/**
 * Every better-sqlite3 that could be loaded at runtime, with the directory a
 * rebuild has to run from for each. `npm rebuild` acts on the tree it is run
 * in, so rebuilding at the microservice root does not touch a copy nested
 * inside a dependency.
 */
function nativeModuleLocations(microserviceDir) {
  const locations = [];

  try {
    locations.push({
      label: 'hoisted',
      cwd: microserviceDir,
      pkgDir: path.dirname(
        require.resolve('better-sqlite3/package.json', {
          paths: [microserviceDir],
        })
      ),
    });
  } catch {
    // Nothing to check if the dependency is not installed at all.
  }

  let sdkDir;

  try {
    sdkDir = path.dirname(
      require.resolve('@liferay/accelerator-sdk/package.json', {
        paths: [microserviceDir],
      })
    );
  } catch {
    return locations;
  }

  const nested = path.join(sdkDir, 'node_modules', 'better-sqlite3');

  if (fs.existsSync(nested)) {
    locations.push({ label: 'accelerator-sdk', cwd: sdkDir, pkgDir: nested });
  }

  return locations;
}

/**
 * Why a copy has to be recompiled, or null when it is fit to load. The
 * architecture verdict comes first and never loads anything; the load probe
 * runs only once the architecture is known to match, which is what makes it
 * safe to run at all, and it targets the resolved file so an ABI mismatch
 * cannot be masked by the loader binding a different copy.
 */
function rebuildReason(pkgDir) {
  const binary = resolveNativeBinary(pkgDir);

  if (!binary) {
    return 'no compiled binary present';
  }

  const arch = binaryArch(binary);

  if (arch && arch !== process.arch) {
    return `built for ${arch}, this process is ${process.arch} (${binary})`;
  }

  try {
    require(binary);

    return null;
  } catch (err) {
    if (
      err.code === 'ERR_DLOPEN_FAILED' ||
      err.message.includes('NODE_MODULE_VERSION')
    ) {
      return err.message.split('\n')[0];
    }

    throw err;
  }
}

function checkAndRebuild() {
  const microserviceDir = path.resolve(__dirname, '..');
  const nodeBin = process.execPath;

  for (const location of nativeModuleLocations(microserviceDir)) {
    checkLocation(location, nodeBin);
  }
}

function checkLocation(location, nodeBin) {
  const reason = rebuildReason(location.pkgDir);

  if (!reason) {
    return;
  }

  console.log(
    `[NativeCheck] Incompatible ${location.label} native module detected for Node ${process.version}: ${reason}`
  );
  console.log(`[NativeCheck] Current Node path: ${nodeBin}`);

  // Locate npm relative to the node binary
  // Gradle's layout: build/node/bin/node and build/node/lib/node_modules/npm/bin/npm-cli.js
  let npmCli = 'npm'; // Default to system path

  const buildNodeNpm = path.resolve(
    nodeBin,
    '../../lib/node_modules/npm/bin/npm-cli.js'
  );
  if (fs.existsSync(buildNodeNpm)) {
    npmCli = `"${nodeBin}" "${buildNodeNpm}"`;
    console.log(`[NativeCheck] Using bundled npm: ${buildNodeNpm}`);
  }

  console.log('[NativeCheck] Rebuilding better-sqlite3...');

  try {
    const cmd = `${npmCli} rebuild better-sqlite3`;
    execSync(cmd, {
      cwd: location.cwd,
      env: rebuildEnv(),
      stdio: 'inherit',
    });
    console.log(`[NativeCheck] Rebuilt the ${location.label} copy.`);

    // Clear require cache so the next require() loads the new binary
    Object.keys(require.cache).forEach((key) => {
      if (key.includes('better-sqlite3') || key.includes('bindings')) {
        delete require.cache[key];
      }
    });
  } catch (rebuildErr) {
    console.error('[NativeCheck] Rebuild failed:', rebuildErr.message);
    process.exit(1);
  }
}

/**
 * `npm rebuild` re-runs better-sqlite3's install script, which is
 * `prebuild-install || node-gyp rebuild`. prebuild-install takes its target
 * architecture from npm_config_arch, so an inherited or stale value would let
 * it fetch the same wrong binary we are here to replace. Naming the package in
 * npm_config_build_from_source makes it compile instead, and only for this
 * package.
 */
function rebuildEnv() {
  const env = {
    ...process.env,
    npm_config_build_from_source: 'better-sqlite3',
  };

  delete env.npm_config_arch;
  delete env.npm_config_platform;

  return env;
}

if (require.main === module) {
  checkAndRebuild();
}

module.exports = {
  binaryArch,
  checkAndRebuild,
  checkLocation,
  nativeModuleLocations,
  rebuildReason,
  resolveNativeBinary,
};
