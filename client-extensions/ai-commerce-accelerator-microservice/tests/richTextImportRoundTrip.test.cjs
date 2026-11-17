const express = require('express');
const multer = require('multer');
const request = require('supertest');
const {
  xssProtectionMiddleware,
} = require('../middleware/securityMiddleware.cjs');

/**
 * A formatted description has to survive the dataset round trip (#1205).
 *
 * The global XSS middleware escapes every string in a JSON body, so it was
 * expected to turn an imported `<p>` into `&lt;p&gt;`. It does not touch an
 * upload: it runs on the API router (server.cjs) while the body is still
 * unparsed, and the import route parses its multipart body itself
 * (`upload.single('importFile')`, routes/import.cjs), after it. Both clients
 * upload a file - the dashboard and `aica import` - so the middleware stays as
 * it is, escaping everything, and this pins the ordering that makes that safe.
 *
 * Built here in the same order as the real server rather than booting it,
 * which needs Liferay.
 */
const DESCRIPTION =
  '<p>Built for <strong>wet</strong> ground.</p><ul><li>Grip</li></ul>';

function appLikeTheServer(received) {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  const api = express.Router();
  api.use(xssProtectionMiddleware);
  api.post(
    '/import-commerce-data',
    multer({ storage: multer.memoryStorage() }).single('importFile'),
    (req, res) => {
      received.dataset = req.file
        ? JSON.parse(req.file.buffer.toString())
        : req.body.dataset;
      res.json({ ok: true });
    }
  );
  app.use('/api/v1', api);
  return app;
}

const dataset = {
  products: [
    { name: { en_US: 'Trail Runner' }, description: { en_US: DESCRIPTION } },
  ],
};

describe('a formatted description through the dataset import', () => {
  it('arrives intact when the dataset is uploaded as a file, as both clients do', async () => {
    const received = {};

    await request(appLikeTheServer(received))
      .post('/api/v1/import-commerce-data')
      .attach(
        'importFile',
        Buffer.from(JSON.stringify(dataset)),
        'dataset.json'
      )
      .expect(200);

    expect(received.dataset.products[0].description.en_US).toBe(DESCRIPTION);
  });

  it('is still escaped when posted as a JSON body, which no client does', async () => {
    const received = {};

    await request(appLikeTheServer(received))
      .post('/api/v1/import-commerce-data')
      .send({ dataset })
      .expect(200);

    expect(received.dataset.products[0].description.en_US).toContain(
      '&lt;p&gt;'
    );
  });
});
