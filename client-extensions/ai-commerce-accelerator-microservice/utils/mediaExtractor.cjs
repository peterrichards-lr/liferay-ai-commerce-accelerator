const { KIND } = require('./mediaBundle.cjs');
const {
  mediaIdentity,
  resolvedMediaIdentities,
} = require('./mediaArchive.cjs');

/**
 * Pulls the binaries behind a dataset's media entries out of the instance that
 * holds them.
 *
 * This is the expensive half of producing a package: it needs access to a live
 * Liferay, credentials for it, and a round trip per attachment. An export
 * packages what this service already has and needs none of that - see #848.
 *
 * `createdImages` and `createdPdfs` record `{ productERC, title, contentType,
 * priority }` and no bytes. That is the constraint - no file content in the
 * database - and it is workable, because `productERC` locates the attachment
 * in Liferay and Liferay has the bytes.
 *
 * The lookup goes through the Commerce API rather than the Document Library.
 * The binaries do live in the DL, but Commerce writes them into a hidden
 * folder under its own portlet repository, so they never appear in Documents
 * and Media and reaching them that way means discovering that folder. The
 * Commerce API is keyed by exactly what a dataset already holds.
 */

/**
 * The part of a `src` that can be trusted.
 *
 * Liferay returns an absolute URL built from its own idea of where it lives,
 * and that is demonstrably not where a caller reaches it. Observed on UAT:
 *
 *   https://webserver-lctsolara-uat.lfr.cloud:8080/o/commerce-media/...
 *
 * The public host serves https on 443; port 8080 is the internal listener. As
 * returned, that URL connects to nothing. The path is the only trustworthy
 * part, so it is what gets passed on - the SDK resolves a relative path
 * against the configured connection, which is where the caller actually
 * reached the instance.
 */
function srcPath(src) {
  if (typeof src !== 'string' || src === '') return src;

  try {
    const parsed = new URL(src);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    // Already relative, which is what we want anyway.
    return src;
  }
}

/**
 * One product's media, both kinds, with failures recorded rather than thrown.
 *
 * A product whose attachments cannot be read costs its own pictures and
 * nothing else. Throwing would abandon a promotion partway through and leave
 * the target with an arbitrary prefix of the catalogue - the same shape as the
 * chunk failure that used to discard every chunk before it (#822).
 *
 * `alreadyResolved` is what makes a repeat call cheap and safe rather than
 * merely repeatable: an attachment whose identity is already in the archive
 * is marked `reused` and its content is never fetched. This is not only
 * performance - `archive.record` calls `forget` first, so re-fetching an
 * attachment that already resolved and having *that* fetch hit a transient
 * error would delete the good file on disk to make room for a failure
 * marker. Skipping it here means a flaky retry can never destroy media a
 * previous run already secured (#895).
 */
async function extractProductMedia({
  alreadyResolved = new Set(),
  config,
  correlationId,
  liferayService,
  logger,
  productERC,
}) {
  const resolved = [];

  const kinds = [
    {
      contentOf: 'getProductImageContent',
      kind: KIND.IMAGE,
      listOf: 'getProductImages',
    },
    {
      contentOf: 'getProductAttachmentContent',
      kind: KIND.PDF,
      listOf: 'getProductAttachments',
    },
  ];

  for (const { contentOf, kind, listOf } of kinds) {
    let attachments;

    try {
      attachments = (await liferayService[listOf](config, productERC)) || [];
    } catch (error) {
      logger?.warn?.(
        `[MediaExtractor] Could not list ${kind}s for ${productERC}: ${error?.message}`,
        { correlationId, productERC }
      );
      resolved.push({
        kind,
        productERC,
        reason: `listing failed: ${error?.message}`,
      });
      continue;
    }

    for (const attachment of attachments) {
      if (
        alreadyResolved.has(
          mediaIdentity({ kind, productERC, title: attachment.title })
        )
      ) {
        resolved.push({
          kind,
          productERC,
          reused: true,
          title: attachment.title,
        });
        continue;
      }

      // `src` is what the content reader wants; the ERC is the fallback,
      // because the catalog API exposes no GET for a numeric attachment id.
      const locator = attachment.src
        ? srcPath(attachment.src)
        : attachment.externalReferenceCode;

      if (!locator) {
        resolved.push({
          contentType: attachment.contentType,
          kind,
          priority: attachment.priority,
          productERC,
          reason: 'attachment carried neither src nor externalReferenceCode',
          title: attachment.title,
        });
        continue;
      }

      try {
        const content = await liferayService[contentOf](config, locator);

        resolved.push({
          buffer: content?.buffer,
          contentType: content?.contentType || attachment.contentType,
          kind,
          priority: attachment.priority ?? 1,
          productERC,
          title: attachment.title,
        });
      } catch (error) {
        logger?.warn?.(
          `[MediaExtractor] Could not read a ${kind} for ${productERC}: ${error?.message}`,
          { correlationId, productERC }
        );
        resolved.push({
          contentType: attachment.contentType,
          kind,
          priority: attachment.priority,
          productERC,
          reason: `content fetch failed: ${error?.message}`,
          title: attachment.title,
        });
      }
    }
  }

  return resolved;
}

/**
 * Every product's media, in dataset order, written to the archive as it
 * arrives.
 *
 * Sequential on purpose. A promotion is a rare, operator-initiated action, and
 * the source instance is usually the one a demo is being prepared on - so the
 * cost of being slow is much lower than the cost of a burst of parallel binary
 * fetches against it.
 *
 * Each binary goes to disk and is released rather than accumulated, so the
 * peak is one attachment rather than the whole catalogue, and what it paid
 * for is still there afterwards: extract once, and every later export of that
 * session is a directory read (#898). The package is then built from the
 * archive by the caller - the same step, from the same place, whichever
 * producer staged it.
 *
 * A failed extract used to mean a retry re-listed and re-downloaded every
 * product's media, whether or not it had already landed on disk. `archive`
 * already carries its own manifest by the time it reaches here (`loadManifest`
 * runs in its constructor), so what it already has successfully resolved is
 * read from that and never fetched again - a retry against the same session
 * fetches only what did not resolve last time (#895).
 */
async function extractDatasetMedia({
  archive,
  config,
  correlationId,
  liferayService,
  logger,
  products = [],
}) {
  const alreadyResolved = resolvedMediaIdentities(archive);
  let staged = 0;
  let reused = 0;
  let unresolved = 0;

  for (const product of products) {
    const productERC = product?.externalReferenceCode;

    if (!productERC) continue;

    const found = await extractProductMedia({
      alreadyResolved,
      config,
      correlationId,
      liferayService,
      logger,
      productERC,
    });

    for (const item of found) {
      // Already on disk from an earlier pass - left untouched. Passing it to
      // `archive.record` would call `forget` first and rewrite a file that
      // was never re-fetched.
      if (item.reused) {
        reused += 1;
        continue;
      }

      // An item that could not be fetched is recorded too, carrying the reason
      // it failed. Dropping it would leave the shortfall to be inferred from a
      // count, which is how a package quietly thinner than its source gets
      // mistaken for a complete one.
      if (archive.record(item)) {
        staged += 1;
      } else {
        unresolved += 1;
      }
    }
  }

  return { reused, staged, unresolved };
}

module.exports = { extractDatasetMedia, extractProductMedia, srcPath };
