/**
 * ensure-native-modules.cjs
 *
 * Automatically detects if native modules (better-sqlite3) are incompatible
 * with the current Node.js runtime and recompiles them if necessary.
 *
 * This prevents the common 'NODE_MODULE_VERSION' mismatch error when
 * switching between developer environments and Gradle build environments.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function checkAndRebuild() {
  const sdkDir = path.resolve(__dirname, '..');
  const nodeBin = process.execPath;

  // Try to load AND instantiate better-sqlite3 to trigger binary load
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    // If we reach here, it's compatible
    return;
  } catch (err) {
    if (
      err.code === 'ERR_DLOPEN_FAILED' ||
      err.message.includes('NODE_MODULE_VERSION') ||
      err.message.includes('Could not locate the bindings file')
    ) {
      console.log(
        `[NativeCheck] Incompatible native module detected for Node ${process.version}.`
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
          cwd: sdkDir,
          stdio: 'inherit',
        });
        console.log('[NativeCheck] Rebuild successful.');

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
