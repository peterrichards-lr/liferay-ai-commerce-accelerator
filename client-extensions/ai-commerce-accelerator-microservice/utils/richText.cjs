/**
 * Formatted product descriptions, so a landing page can be built from the
 * description field (#1205).
 *
 * `description` carries HTML from a small allowlist; `shortDescription` stays
 * plain text. The model's output is untrusted, so everything it returns is put
 * through `sanitizeRichText` before it reaches Liferay: the eight tags below
 * survive with every attribute removed, and anything else - `<script>`,
 * `<iframe>`, `<img onerror>` - is escaped into visible text rather than
 * half-removed. Written here rather than taken from DOMPurify, which needs a
 * DOM (jsdom) under Node: a lot to add for an allowlist with no attributes.
 */

const ALLOWED_TAGS = new Set([
  'p',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'h3',
  'br',
]);

// One tag, opening or closing, with whatever attributes it carries. Anything
// that does not match - a lone `<`, a comment, a doctype - is text.
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^<>]*>/g;

const escapeText = (text) => text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeAll = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function sanitizeRichText(html) {
  if (typeof html !== 'string') return html;

  let out = '';
  let last = 0;
  for (const match of html.matchAll(TAG)) {
    out += escapeText(html.slice(last, match.index));
    const [token, closing, name] = match;
    const tag = name.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      out += escapeAll(token);
    } else if (tag === 'br') {
      out += '<br>';
    } else {
      out += `<${closing}${tag}>`;
    }
    last = match.index + token.length;
  }
  return out + escapeText(html.slice(last));
}

const ENTITIES = new Map([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&#x27;', "'"],
  ['&nbsp;', ' '],
]);

/** The text a reader sees, with block boundaries kept as spaces. */
function toPlainText(html) {
  if (typeof html !== 'string') return html;

  return html
    .replace(/<br\s*\/?>|<\/(p|li|h3)>/gi, ' ')
    .replace(/<[^<>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (entity) =>
      ENTITIES.get(entity)
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A plain-text summary of at most `max` characters, cut at a word boundary.
 * Used where a short description has to be derived from a long one, which
 * used to be `substring(0, 200)` on the raw string - on HTML that cuts inside
 * a tag and puts broken markup in a second field.
 */
function summarise(html, max = 200) {
  const text = toPlainText(html);
  if (typeof text !== 'string' || text.length <= max) return text;

  const cut = text.slice(0, max - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** Applies `fn` to a plain string or to every value of a localized map. */
function mapLocalized(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([lang, text]) => [lang, fn(text)])
  );
}

module.exports = {
  ALLOWED_TAGS,
  mapLocalized,
  sanitizeRichText,
  summarise,
  toPlainText,
};
