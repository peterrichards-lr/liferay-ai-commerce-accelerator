const MEDIA_SCOPES = {
  ALL: 'all',
  MISSING: 'missing',
};

const attachedErcs = (created) =>
  new Set((created || []).map((entry) => entry.productERC).filter(Boolean));

/**
 * Which products a media run should cover.
 *
 * Recovery is partial by nature: the run behind #673 lost 39 of its 50 images
 * and keeping the 11 it paid for matters. What was attached is read from the
 * source session rather than from Liferay because `createImages` and
 * `createPdfs` catch per-product failures inside their loops - they either
 * throw before attaching anything or resolve with the full record of what they
 * attached - so `createdImages` and `createdPdfs` are an exact record of the
 * products that session covered.
 *
 * Images and PDFs are scoped separately because they are selected by separate
 * ratios, so a product can be missing one and not the other; scoping them
 * together would attach a second copy of whichever it already has.
 */
function selectProductsForMedia(
  sourceContext,
  { scope = MEDIA_SCOPES.MISSING, externalReferenceCodes = [] } = {}
) {
  const allProducts = sourceContext?.productDataList || [];

  const candidates = externalReferenceCodes.length
    ? allProducts.filter((product) =>
        externalReferenceCodes.includes(product.externalReferenceCode)
      )
    : allProducts;

  if (scope === MEDIA_SCOPES.ALL) {
    return { imageProducts: candidates, pdfProducts: candidates };
  }

  const withImages = attachedErcs(sourceContext?.createdImages);
  const withPdfs = attachedErcs(sourceContext?.createdPdfs);

  return {
    imageProducts: candidates.filter(
      (product) => !withImages.has(product.externalReferenceCode)
    ),
    pdfProducts: candidates.filter(
      (product) => !withPdfs.has(product.externalReferenceCode)
    ),
  };
}

module.exports = { MEDIA_SCOPES, selectProductsForMedia };
