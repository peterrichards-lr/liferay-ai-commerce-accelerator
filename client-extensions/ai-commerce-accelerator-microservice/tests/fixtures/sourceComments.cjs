/**
 * Comment stripping for guards that scan source.
 *
 * A guard that reads a file - or a function's text - and asserts a construct
 * is present or absent must match against code, never prose. The same matcher
 * fails both ways:
 *
 *   expect(source).not.toMatch(/head/)  fires on "`sed -n` rather than `head`"
 *   expect(source).toMatch(/ldm_cmd/)   passes on a comment describing the call
 *
 * The second direction is the dangerous one: it is silent, and it leaves a
 * guard that would survive deleting the line it exists to protect. This has
 * now happened five times, each fixed as an instance (#1072/#1073, #1171,
 * #1173) rather than as a class. See #1172.
 *
 * These are for source scans only. A guard asserting a *value* is absent from
 * *captured output* - a log, an artifact, a rendered prompt, an API response -
 * must not use them: a `#` in a log line is data, and removing it would hide
 * the very thing being looked for.
 *
 * Both strippers preserve the line structure of the input: a comment's text is
 * removed, its newline is not. Line indices into the stripped text therefore
 * still line up with the original file, which is what the ordering guards
 * ("the trap is installed before the readiness wait") depend on.
 */

/**
 * Removes `#` comments: shell, YAML, Python, Dockerfiles, .properties.
 *
 * `#` opens a comment only at the start of a line or after whitespace, which
 * is the shell's own rule - so `${VAR#prefix}`, `$#` and `url#fragment`
 * survive, as does any `#` inside single or double quotes.
 *
 * @param {string} text
 * @returns {string}
 */
function withoutHashComments(text) {
  let out = '';
  let quote = null;
  let atWordStart = true;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (quote) {
      if (quote === '"' && c === '\\' && i + 1 < text.length) {
        out += c + text[i + 1];
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      continue;
    }

    if (c === '\\' && i + 1 < text.length && text[i + 1] !== '\n') {
      out += c + text[i + 1];
      i += 1;
      atWordStart = false;
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      out += c;
      atWordStart = false;
      continue;
    }

    if (c === '#' && atWordStart) {
      while (i < text.length && text[i] !== '\n') i += 1;
      // The newline itself is kept, so line numbers do not move.
      if (i < text.length) out += '\n';
      atWordStart = true;
      continue;
    }

    out += c;
    atWordStart = c === '\n' || c === ' ' || c === '\t';
  }

  return out;
}

/**
 * Removes `//` and slash-star comments: JavaScript, JSX, Gradle, Java.
 *
 * String and template literals are tracked, so a `//` inside `'https://x'`
 * survives. Regular-expression literals are not tracked: `/\/\//` - two
 * escaped slashes - reads as a line comment and takes the rest of the line
 * with it. That is the one input this cannot be trusted on, and it is why
 * `sourceComments.test.cjs` asserts what survives rather than only what goes.
 *
 * @param {string} text
 * @returns {string}
 */
function withoutSlashComments(text) {
  let out = '';
  let quote = null;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (quote) {
      if (c === '\\') {
        out += c + (next ?? '');
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i += 1;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }

    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        // Newlines inside a block comment are kept, so line numbers hold.
        if (text[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

module.exports = { withoutHashComments, withoutSlashComments };
