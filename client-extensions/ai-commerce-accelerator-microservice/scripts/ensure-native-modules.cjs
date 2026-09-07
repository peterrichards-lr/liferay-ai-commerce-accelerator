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
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Every better-sqlite3 that could be loaded at runtime, with the directory a
 * rebuild has to run from for each. `npm rebuild` acts on the tree it is run
 * in, so rebuilding at the microservice root does not touch a copy nested
 * inside a dependency.
 */
function nativeModuleLocations(microserviceDir) {
  const locations = [{ label: 'hoisted', cwd: microserviceDir, entry: null }];

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
    locations.push({ label: 'accelerator-sdk', cwd: sdkDir, entry: nested });
  }

  return locations;
}

function loads(entry) {
  try {
    // eslint-disable-next-line global-require
    const Database = entry ? require(entry) : require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return null;
  } catch (err) {
    return err;
  }
}

function checkAndRebuild() {
  const microserviceDir = path.resolve(__dirname, '..');
  const nodeBin = process.execPath;

  for (const location of nativeModuleLocations(microserviceDir)) {
    checkLocation(location, microserviceDir, nodeBin);
  }
}

function checkLocation(location, microserviceDir, nodeBin) {
  const err = loads(location.entry);

  if (!err) {
    return;
  }

  {
    if (
      err.code === 'ERR_DLOPEN_FAILED' ||
      err.message.includes('NODE_MODULE_VERSION') ||
      err.message.includes('Could not locate the bindings file')
    ) {
      console.log(
        `[NativeCheck] Incompatible ${location.label} native module detected for Node ${process.version}.`
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
    } else {
      // Re-throw if it's a different error
      throw err;
    }
  }
}

if (require.main === module) {
  checkAndRebuild();
}

module.exports = { checkAndRebuild };
