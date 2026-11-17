const {
  mapLocalized,
  sanitizeRichText,
  summarise,
  toPlainText,
} = require('../utils/richText.cjs');

/**
 * Product descriptions are HTML from an eight-tag allowlist with no
 * attributes, and the model that writes them is untrusted (#1205).
 */
describe('sanitizeRichText', () => {
  it('keeps the formatting a landing page needs', () => {
    const html =
      '<h3>Built for wet trails</h3><p>The <strong>Trail Runner</strong> is <em>light</em>.<br>Really.</p>' +
      '<ul><li>Grip</li><li>Drainage</li></ul><ol><li>One</li></ol>';

    expect(sanitizeRichText(html)).toBe(html);
  });

  it('strips every attribute from an allowed tag', () => {
    expect(
      sanitizeRichText(
        '<p class="x" style="color:red" onclick="steal()">Hi</p>'
      )
    ).toBe('<p>Hi</p>');
    expect(sanitizeRichText('<strong onmouseover=alert(1)>Bold</strong>')).toBe(
      '<strong>Bold</strong>'
    );
  });

  it('normalises case and self-closing breaks', () => {
    expect(sanitizeRichText('<P>Hi<BR/>there</P>')).toBe('<p>Hi<br>there</p>');
  });

  it('turns any other tag into visible text rather than half-removing it', () => {
    expect(sanitizeRichText('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(sanitizeRichText('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
    expect(
      sanitizeRichText('<iframe src="javascript:alert(1)"></iframe>')
    ).toBe('&lt;iframe src="javascript:alert(1)"&gt;&lt;/iframe&gt;');
    expect(sanitizeRichText('<a href="https://x.test">link</a>')).toBe(
      '&lt;a href="https://x.test"&gt;link&lt;/a&gt;'
    );
  });

  it('cannot be tricked into reassembling a tag', () => {
    const out = sanitizeRichText('<scr<script>ipt>alert(1)</script>');

    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<[a-z]/i);
  });

  it('escapes a stray angle bracket in text', () => {
    expect(sanitizeRichText('<p>5 < 6 and 7 > 3</p>')).toBe(
      '<p>5 &lt; 6 and 7 &gt; 3</p>'
    );
    expect(sanitizeRichText('<!-- note --><p>x</p>')).toBe(
      '&lt;!-- note --&gt;<p>x</p>'
    );
  });

  it('leaves entities in text alone', () => {
    expect(sanitizeRichText('<p>Salt &amp; pepper</p>')).toBe(
      '<p>Salt &amp; pepper</p>'
    );
  });

  it('passes plain text and non-strings through', () => {
    expect(sanitizeRichText('Just prose.')).toBe('Just prose.');
    expect(sanitizeRichText(undefined)).toBeUndefined();
  });
});

describe('toPlainText', () => {
  it('keeps the words and the gaps between blocks', () => {
    expect(
      toPlainText(
        '<h3>Built</h3><p>Light &amp; <strong>fast</strong>.</p><ul><li>Grip</li><li>Drain</li></ul>'
      )
    ).toBe('Built Light & fast. Grip Drain');
  });

  it('decodes the entities the sanitiser can leave behind', () => {
    expect(toPlainText('5 &lt; 6 &gt; 4 &quot;q&quot; it&#x27;s&nbsp;ok')).toBe(
      '5 < 6 > 4 "q" it\'s ok'
    );
  });
});

describe('summarise', () => {
  it('returns short text whole', () => {
    expect(summarise('<p>Short and sweet.</p>')).toBe('Short and sweet.');
  });

  it('cuts at a word boundary, never inside a tag', () => {
    const html = `<p>${'word '.repeat(80)}</p><ul><li>tail</li></ul>`;
    const out = summarise(html, 50);

    expect(out.length).toBeLessThanOrEqual(50);
    expect(out).not.toMatch(/[<>]/);
    expect(out).toMatch(/word…$/);
  });
});

describe('mapLocalized', () => {
  it('maps a localized map value by value, and a plain string directly', () => {
    expect(mapLocalized({ en_US: 'a', es_ES: 'b' }, (s) => s + '!')).toEqual({
      en_US: 'a!',
      es_ES: 'b!',
    });
    expect(mapLocalized('a', (s) => s + '!')).toBe('a!');
    expect(mapLocalized(undefined, (s) => s + '!')).toBeUndefined();
  });
});
