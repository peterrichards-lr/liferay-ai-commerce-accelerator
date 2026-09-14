const { Writable } = require('stream');

/**
 * A response double that behaves like Express far enough to exercise the
 * bundle routes: it is a real `Writable`, so `readableStream.pipe(res)` works
 * exactly as it does against `http.ServerResponse` (#877 moved
 * routes/export.cjs off `res.send(buffer)` and onto that). Every written
 * chunk is collected, and once the stream ends `res.body` is the
 * concatenation of them - the same place a caller reading `res.body` after
 * `res.send(buffer)` used to find it, so the four suites that built this
 * fixture locally did not have to change their assertions, only how they
 * construct the response.
 *
 * `headersSent` flips on the first written chunk (or a direct `.json()` /
 * `.send()`), mirroring the signal the real error handling in
 * routes/export.cjs checks: once bytes are on their way out, a second JSON
 * response is not a response a client can make sense of.
 */
function createHttpResponse() {
  const headers = {};
  const chunks = [];

  const res = new Writable({
    write(chunk, _encoding, callback) {
      res.headersSent = true;
      chunks.push(chunk);
      callback();
    },
  });

  res.body = null;
  res.headers = headers;
  res.headersSent = false;
  res.statusCode = 200;

  res.setHeader = (name, value) => {
    headers[name] = value;
  };
  res.json = (body) => {
    res.headersSent = true;
    res.body = body;
    return res;
  };
  res.send = (body) => {
    res.headersSent = true;
    res.body = body;
    return res;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.on('finish', () => {
    if (chunks.length > 0) {
      res.body = Buffer.concat(chunks);
    }
  });

  return res;
}

module.exports = { createHttpResponse };
