const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { logger } = require('../utils/logger.cjs');

/**
 * The suite's own logging must never reach the checkout's real app.log
 * (#794). A generate run was mid-flight when the suite ran in the same
 * checkout, and the service log picked up 37 fixture "reads as a fraction"
 * warnings alongside real XSS-probe and signature-rejection lines - none of
 * it from the run, all of it indistinguishable from the run's own
 * diagnostics once interleaved.
 *
 * Comparing configuration (ENV.LOGS_DIR, logger.logFile) against the real
 * path would only prove the redirect variable looks right, not that writing
 * actually lands somewhere else - a typo that left both pointing at the same
 * file would still "pass" that kind of check. So this writes a real, unique
 * line through the logger and confirms it exists where the redirect says it
 * should, and is absent from the real file the shipped default names -
 * asserting the outcome the fix exists to produce, not just its
 * configuration.
 */
describe("the suite's own logging cannot reach logs/app.log (#794)", () => {
  // Independent of ENV.LOGS_DIR, which this process has already redirected -
  // this is the path utils/constants.cjs falls back to when nothing
  // overrides it, i.e. what a real, non-test run writes to.
  const realLogFile = path.join(__dirname, '..', 'logs', 'app.log');

  it('resolves logger.logFile outside the checkout, under the OS temp directory', () => {
    expect(logger.logFile).not.toBe(realLogFile);

    const resolvedLogFile = fs.realpathSync(path.dirname(logger.logFile));
    const tmpRoot = fs.realpathSync(os.tmpdir());

    expect(resolvedLogFile.startsWith(tmpRoot)).toBe(true);
  });

  it('writes reach the redirected file and never the real one', () => {
    const marker = `log-isolation-marker-${crypto.randomUUID()}`;

    logger.info(marker);

    expect(fs.existsSync(logger.logFile)).toBe(true);
    expect(fs.readFileSync(logger.logFile, 'utf8')).toContain(marker);

    // The real file may already exist - the service this suite must not
    // interfere with is running alongside it (#794) - so this only asserts
    // that whatever it contains, it does not contain lines this test wrote.
    if (fs.existsSync(realLogFile)) {
      expect(fs.readFileSync(realLogFile, 'utf8')).not.toContain(marker);
    }
  });

  it("ships pointed at the checkout's logs/ directory when nothing redirects it", () => {
    // Read from source, the way tests/mediaArchiveDefault.test.cjs asserts the
    // shipped MEDIA_ARCHIVE_PATH default: this process's own ENV.LOGS_DIR is
    // never the shipped value, because tests/setup.mjs has already
    // redirected it.
    const constants = fs.readFileSync(
      path.join(__dirname, '..', 'utils', 'constants.cjs'),
      'utf8'
    );

    expect(constants).toContain(
      "LOGS_DIR: str('LOGS_DIR', path.join(__dirname, '..', 'logs'))"
    );
  });
});
