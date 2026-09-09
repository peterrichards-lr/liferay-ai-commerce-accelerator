const { fromI18n } = require('./misc.cjs');

/**
 * What makes two generated products the same product, and the record of what a
 * run has produced so far.
 *
 * `aiService.generateProductData` splits a large request into independent model
 * calls - 50 products into 5 chunks of 10 - and asked five times for
 * motorcycle accessories the model invents the same obvious products each time.
 * A live 50-product run returned 9 duplicated names and 6 duplicated base
 * SKUs: five products called "Keyed-Alike Lock System", four called "BMW
 * R1250GS Mounting Kit". Nothing was corrupted - the product external
 * reference codes and the 90 variant SKU codes were all distinct - but a
 * storefront listing five identically named products is the first thing a
 * demo audience notices. See #798.
 *
 * **Duplicate means the name or the base SKU, either one.** The chain the
 * top-up rounds used - `baseSku || externalReferenceCode || name` - is a
 * precedence, not a disjunction, so a product with a base SKU was compared on
 * that alone and the nine repeated names went through untouched. And the
 * external reference code has no place in the comparison at all: the model
 * builds it to be unique (`prompts/product.md` asks for "PRODUCT-001-
 * 1234567890") and `generation.cjs` overwrites it with a fresh ERC regardless,
 * so including it can only mask a real collision.
 *
 * Rejecting the *second* occurrence of a name, rather than the fifth, is
 * deliberate. Two genuinely different products can share a name in a real
 * catalogue, but this generator is not producing two different products - the
 * repeats arrive with near-identical base SKUs (MT-BMW-R1250GS three times
 * over), which is the same idea invented again. The shortfall a rejection
 * leaves is what the top-up rounds exist to close.
 *
 * A product identified by neither is rejected too: Liferay requires a name, so
 * it is not a product that could be created, and counting it toward the
 * requested total would hide the shortfall instead of closing it.
 */

/**
 * The name a storefront would show. Multilingual objects reduce through
 * `fromI18n`, which prefers `en_US` and otherwise takes the first translation,
 * so a run in one language still compares on something.
 */
function productName(product) {
  return String(fromI18n(product?.name) || '').trim();
}

function productBaseSku(product) {
  return String(product?.baseSku || '').trim();
}

function comparable(value) {
  return value.toLowerCase();
}

/**
 * The running record. `add` reports whether the product was new, and records it
 * when it was; `avoid` is what the next chunk is told not to repeat.
 */
function createProductLedger() {
  const names = [];
  const baseSkus = [];
  const seenNames = new Set();
  const seenBaseSkus = new Set();

  return {
    add(product) {
      const name = productName(product);
      const baseSku = productBaseSku(product);
      const nameKey = comparable(name);
      const baseSkuKey = comparable(baseSku);

      if (!nameKey && !baseSkuKey) {
        return false;
      }

      if (
        (nameKey && seenNames.has(nameKey)) ||
        (baseSkuKey && seenBaseSkus.has(baseSkuKey))
      ) {
        return false;
      }

      if (nameKey) {
        names.push(name);
        seenNames.add(nameKey);
      }

      if (baseSkuKey) {
        baseSkus.push(baseSku);
        seenBaseSkus.add(baseSkuKey);
      }

      return true;
    },

    avoid() {
      return { baseSkus: [...baseSkus], names: [...names] };
    },
  };
}

module.exports = {
  createProductLedger,
  productBaseSku,
  productName,
};
