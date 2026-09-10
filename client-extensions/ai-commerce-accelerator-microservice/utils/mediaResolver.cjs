const { KIND } = require('./mediaBundle.cjs');

/**
 * Fetches the binaries behind a dataset's media entries, from the instance
 * that holds them.
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
 * One product's media, both kinds, with failures recorded rather than thrown.
 *
 * A product whose attachments cannot be read costs its own pictures and
 * nothing else. Throwing would abandon a promotion partway through and leave
 * the target with an arbitrary prefix of the catalogue - the same shape as the
 * chunk failure that used to discard every chunk before it (#822).
 */
async function resolveProductMedia({
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
        `[MediaResolver] Could not list ${kind}s for ${productERC}: ${error?.message}`,
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
      // `src` is what the content reader wants; the ERC is the fallback,
      // because the catalog API exposes no GET for a numeric attachment id.
      const locator = attachment.src || attachment.externalReferenceCode;

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
          `[MediaResolver] Could not read a ${kind} for ${productERC}: ${error?.message}`,
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
 * Every product's media, in dataset order.
 *
 * Sequential on purpose. A promotion is a rare, operator-initiated action, and
 * the source instance is usually the one a demo is being prepared on - so the
 * cost of being slow is much lower than the cost of a burst of parallel binary
 * fetches against it.
 */
async function resolveDatasetMedia({
  config,
  correlationId,
  liferayService,
  logger,
  products = [],
}) {
  const media = [];

  for (const product of products) {
    const productERC = product?.externalReferenceCode;

    if (!productERC) continue;

    media.push(
      ...(await resolveProductMedia({
        config,
        correlationId,
        liferayService,
        logger,
        productERC,
      }))
    );
  }

  return media;
}

module.exports = { resolveDatasetMedia, resolveProductMedia };
