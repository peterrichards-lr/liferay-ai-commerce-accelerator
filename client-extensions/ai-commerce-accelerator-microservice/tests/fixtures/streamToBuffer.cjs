/**
 * Collects a readable stream into one `Buffer`, for assertions only.
 *
 * `buildMediaBundle` stopped returning a `Buffer` so that a real caller never
 * has to hold the whole archive in memory (#877); a test asserting on the
 * bytes still needs one, and doing that collection here rather than in the
 * production code is the whole point of the split.
 */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

module.exports = { streamToBuffer };
