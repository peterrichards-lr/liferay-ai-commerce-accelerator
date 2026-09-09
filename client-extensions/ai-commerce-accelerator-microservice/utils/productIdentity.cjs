/**
 * A Liferay product has two numeric ids, and they are not interchangeable.
 *
 * The Headless Commerce Admin Catalog `Product` DTO reports both under names
 * that invite exactly the wrong choice:
 *
 *   id        -> the CProduct. The catalog entry, stable across versions.
 *   productId -> the CPDefinition. The versioned definition that actually
 *                owns the options, SKUs, specifications and media.
 *
 * **Every product-scoped path takes the definition id.** Verified against a
 * live 2026.q1.12 instance for a product whose CProduct id was 41289 and
 * CPDefinition id 41290:
 *
 *   /products/{id}                     404  |  /products/{productId}      200
 *   /products/{id}/productOptions      404  |  .../productOptions         200
 *   /products/{id}/productSpecifications 404 | .../productSpecifications  200
 *   /products/{id}/images              404  |  .../images                 200
 *   /products/{id}/attachments         404  |  .../attachments            200
 *   /products/{id}/skus            200 []   |  .../skus                   200 [9]
 *   /products/{id}/product-channels 200 []  |  .../product-channels       200 [1]
 *
 * The last two are why this module exists rather than a comment. They do not
 * fail - they answer 200 with an empty collection - so the wrong id reads as
 * "this product has no SKUs" instead of as an error. That is indistinguishable
 * from a real empty result at the call site and cannot be caught downstream.
 *
 * This cost a run: `resolve-product-ids` asked Liferay for `id` only, so the
 * definition id was never fetched, the option read-back 404ed, every SKU lost
 * its option links and Liferay marked all 90 SKUs inactive (#748).
 *
 * `productDataList[].id` is retained as the CProduct id because
 * PromoGenerator still reads it (#757). New callers should name the one they
 * mean.
 */

const CPRODUCT_ID = 'cProductId';
const CP_DEFINITION_ID = 'cpDefinitionId';

function positiveId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

/**
 * Both ids from a resolved Liferay product, under names that say which is
 * which. Absent ids stay absent rather than becoming 0, so a caller can tell
 * "not resolved" from "resolved to nothing".
 */
function productIdentity(resolvedProduct) {
  return {
    [CPRODUCT_ID]: positiveId(resolvedProduct?.id),
    [CP_DEFINITION_ID]: positiveId(resolvedProduct?.productId),
  };
}

/**
 * The id every product-scoped catalog path expects.
 *
 * Falls back to nothing rather than to the CProduct id: a request built from
 * the wrong id either 404s or silently returns an empty collection, and both
 * are worse than not making the call.
 */
function definitionIdOf(product) {
  return positiveId(product?.[CP_DEFINITION_ID]);
}

/**
 * The id the deletion path addresses a crawled product by.
 *
 * Its manifest is not `productDataList`: deleteCoordinatorService crawls
 * `getProducts` and keeps the `Product` DTOs as Liferay returned them, so
 * `productId` here is the CPDefinition and `id` the CProduct, exactly as
 * documented above. The SDK reads the same shape the same way - product
 * discovery requests `productId` alone, pages by `productId eq {x}` and
 * deletes by `productId || id`.
 *
 * The fallback to the CProduct id is what the delete path has always done and
 * is kept deliberately. It cannot reach another product's entities: the paths
 * it feeds (`/products/{x}`, `.../productOptions`, `.../productSpecifications`)
 * answer 404 to a CProduct id, so a fallback that is wrong clears nothing.
 */
function deletionTargetIdOf(product) {
  return positiveId(product?.productId) ?? positiveId(product?.id);
}

module.exports = {
  CPRODUCT_ID,
  CP_DEFINITION_ID,
  definitionIdOf,
  deletionTargetIdOf,
  productIdentity,
};
