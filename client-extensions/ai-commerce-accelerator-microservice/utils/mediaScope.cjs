const { KIND } = require('./mediaBundle.cjs');
const { srcPath } = require('./mediaExtractor.cjs');

const MEDIA_SCOPES = {
  ALL: 'all',
  MISSING: 'missing',
};

/**
 * A title reduced to something two records of the same file agree on.
 *
 * Titles are localised maps - `{ en_US: 'Trail Boot main' }` from the
 * generator, whatever Liferay held from an extract - so they cannot be
 * compared as objects. The distinct values, sorted, are order-independent and
 * survive one side carrying a locale the other does not, which happens when a
 * run configured for two languages is compared against a record made by a run
 * configured for one.
 */
function titleKey(title) {
  if (typeof title === 'string') return title.trim();

  if (title && typeof title === 'object') {
    return [
      ...new Set(
        Object.values(title)
          .filter((value) => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
      ),
    ]
      .sort()
      .join('|');
  }

  return '';
}

const priorityOf = (entry) => entry?.priority ?? 1;

/**
 * Whether two media entries describe the same file.
 *
 * Returns `null` - not `false` - when the two carry nothing in common to
 * compare on. That third answer is the whole point: "these are different
 * pictures" and "I cannot tell" lead to opposite decisions, and collapsing
 * them into `false` is what would make this attach a second copy of a picture
 * a product already has.
 *
 * The tiers are tried in order of how much they prove. `attachmentERC` is the
 * attachment's own reference, unique per file, recorded since #838. `src` is
 * the path the bytes are served from, compared through the same `srcPath` the
 * extractor trusts, because the host in a Liferay-returned URL is that
 * instance's idea of where it lives and not where anyone reaches it (#814).
 * Title and priority are last and are what a pre-#838 entry and a bundle
 * manifest both carry, so they are what makes an older session comparable at
 * all.
 */
function sameAttachment(a, b) {
  if (a?.attachmentERC && b?.attachmentERC) {
    return a.attachmentERC === b.attachmentERC;
  }

  if (a?.src && b?.src) return srcPath(a.src) === srcPath(b.src);

  const left = titleKey(a?.title);
  const right = titleKey(b?.title);

  if (left && right) return left === right && priorityOf(a) === priorityOf(b);

  return null;
}

function byProduct(entries) {
  const grouped = new Map();

  for (const entry of entries || []) {
    if (!entry?.productERC) continue;

    const forProduct = grouped.get(entry.productERC);

    if (forProduct) forProduct.push(entry);
    else grouped.set(entry.productERC, [entry]);
  }

  return grouped;
}

/**
 * What a product is declared to hold, per kind.
 *
 * The declaration is a bundle manifest's `files` - `{ kind, productERC, title,
 * priority }` per file, the shape #852 already writes and reads - supplied
 * either by the caller or persisted on the session that imported it. An entry
 * with no `kind` is dropped rather than guessed at: images and PDFs are
 * selected by separate ratios and scoped separately, and a declaration leaking
 * across the two would top up the wrong one.
 */
function declaredMedia(sourceContext, expectedMedia, kind) {
  const declared =
    (Array.isArray(expectedMedia) ? expectedMedia : expectedMedia?.files) ||
    sourceContext?.mediaManifest?.files ||
    [];

  return byProduct(declared.filter((entry) => entry?.kind === kind));
}

/**
 * Whether a product already holds everything it is meant to hold.
 *
 * Undeclared is the common case - a generated run, a plain JSON import, any
 * session made before #814 - and there the old question is the only one that
 * can be asked: does this product have media of this kind at all. A
 * declaration only ever adds missingness. It is read as "this product should
 * have these files", never as "and nothing else", so a product the bundle
 * carried nothing for is still a product a later run can illustrate, which is
 * what a media-only run over an imported catalogue is usually for.
 *
 * With a declaration, each declared file looks for its own counterpart. A file
 * that matched nothing and was comparable against everything on offer is
 * absent, and the product is short. The count comparison at the end is not the
 * rule - it is what is left when identity ran out, which is a real state: a
 * pre-#838 record whose titles are gone can be compared on nothing else, and
 * "fewer than declared" beats "has one, so it is done".
 */
function holdsAllDeclared(declared, attached) {
  if (declared.length === 0) return attached.length > 0;

  const claimed = new Set();
  let absent = 0;

  for (const wanted of declared) {
    let match = -1;
    let undecidable = false;

    for (const [index, held] of attached.entries()) {
      if (claimed.has(index)) continue;

      const verdict = sameAttachment(wanted, held);

      if (verdict === true) {
        match = index;
        break;
      }
      if (verdict === null) undecidable = true;
    }

    if (match !== -1) claimed.add(match);
    else if (!undecidable) absent++;
  }

  return absent === 0 && attached.length >= declared.length;
}

/**
 * Which products a media run should cover.
 *
 * Recovery is partial by nature: the run behind #673 lost 39 of its 50 images
 * and keeping the 11 it paid for matters. What was attached is read from the
 * source session rather than from Liferay because `createImages` and
 * `createPdfs` catch per-product failures inside their loops - so
 * `createdImages` and `createdPdfs` are the record of what those runs
 * attached.
 *
 * That record used to be reduced to a set of product codes, which said
 * everything there was to say while a product had at most one image: one is
 * all-or-nothing. It stopped saying enough as soon as a product could carry a
 * gallery - three pictures from the picsum path, or whatever a source instance
 * held once #852 let a dataset carry its media between instances. A product
 * holding one image of three was indistinguishable from one holding all three,
 * so a `missing` run would never top it up (#851). Note this is not only a
 * cross-instance problem: `createImages` aborts the rest of a product's files
 * when one of them throws, so a single generated run already records prefixes.
 *
 * So coverage is decided per attachment, and "missing" means *a file that was
 * declared has no counterpart here* - matched on the attachment's own
 * reference, else on the path its bytes are served from, else on title and
 * priority. It deliberately does not mean "fewer files than before": three
 * declared against three unrelated files is a product that lost all three and
 * counting says it is complete, while two of the declared three plus one
 * unrelated is a product missing exactly one. Counting is the fallback for
 * entries that carry no identity to compare, not the rule.
 *
 * The declaration has to come from outside this record - what a product holds
 * cannot also be the proof of what it should hold - so it is a bundle manifest,
 * passed in as `expectedMedia` or persisted as `sourceContext.mediaManifest`.
 * Nothing writes that key yet: the import route holds the manifest but keeps it
 * out of the session, so a bundle-imported dataset still falls back to the
 * per-product rule until it carries it (#851, follow-up to #814).
 *
 * Images and PDFs are scoped separately because they are selected by separate
 * ratios, so a product can be missing one and not the other; scoping them
 * together would attach a second copy of whichever it already has.
 */
function selectProductsForMedia(
  sourceContext,
  {
    scope = MEDIA_SCOPES.MISSING,
    externalReferenceCodes = [],
    expectedMedia = null,
  } = {}
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

  const missing = (attachedEntries, kind) => {
    const attached = byProduct(attachedEntries);
    const declared = declaredMedia(sourceContext, expectedMedia, kind);

    return candidates.filter(
      (product) =>
        !holdsAllDeclared(
          declared.get(product.externalReferenceCode) || [],
          attached.get(product.externalReferenceCode) || []
        )
    );
  };

  return {
    imageProducts: missing(sourceContext?.createdImages, KIND.IMAGE),
    pdfProducts: missing(sourceContext?.createdPdfs, KIND.PDF),
  };
}

module.exports = { MEDIA_SCOPES, selectProductsForMedia };
