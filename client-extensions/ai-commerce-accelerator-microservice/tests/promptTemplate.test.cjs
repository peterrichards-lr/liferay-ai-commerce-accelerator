const { renderTemplate, substitute } = require('../utils/promptTemplate.cjs');
const { PromptService } = require('../services/promptService.cjs');

function logger() {
  return { error: vi.fn() };
}

describe('prompt template engine', () => {
  describe('conditionals and loops', () => {
    // The whole point of #655: a prompt author can express this without a
    // helper in utils/promptContext.cjs and a commit.
    const template = [
      'Addresses:',
      '{% if geographicContext %}',
      '- country: {{ geographicContext.countryISOCode }}',
      '{% else %}',
      '- country: The two-letter ISO country code.',
      '{% endif %}',
      'End.',
    ].join('\n');

    it('emits the taken branch only', () => {
      expect(
        renderTemplate(template, {
          geographicContext: { countryISOCode: 'DE' },
        })
      ).toBe('Addresses:\n- country: DE\nEnd.');
    });

    it('emits the other branch only', () => {
      // #643: both branches fired at once, so the prompt asked for an exact
      // code and a plausible invention in the same breath.
      expect(renderTemplate(template, {})).toBe(
        'Addresses:\n- country: The two-letter ISO country code.\nEnd.'
      );
    });

    it('expands a loop over real data', () => {
      const text = renderTemplate(
        '{% for vocabulary in vocabularies %}\n- {{ vocabulary.name }}\n{% endfor %}',
        { vocabularies: [{ name: 'Tool Type' }, { name: 'Material' }] }
      );

      expect(text).toBe('- Tool Type\n- Material\n');
    });

    it('expands a loop over nothing to nothing', () => {
      expect(
        renderTemplate('a\n{% for x in xs %}\n- {{ x }}\n{% endfor %}\nb', {
          xs: [],
        })
      ).toBe('a\nb');
    });
  });

  describe('filters', () => {
    it('resolves map(attribute=...) | join(...)', () => {
      // nunjucks 3.2.4 ships selectattr and rejectattr but no map, and this is
      // the expression the prompts were written with.
      expect(
        renderTemplate("{{ languages | map(attribute='id') | join(', ') }}", {
          languages: [{ id: 'en_US' }, { id: 'fr_FR' }],
        })
      ).toBe('en_US, fr_FR');
    });

    it('resolves a dotted attribute', () => {
      expect(
        renderTemplate("{{ xs | map(attribute='a.b') | join('/') }}", {
          xs: [{ a: { b: 1 } }, { a: { b: 2 } }],
        })
      ).toBe('1/2');
    });

    it('applies a named filter across a sequence', () => {
      expect(
        renderTemplate("{{ xs | map('upper') | join(', ') }}", {
          xs: ['red', 'blue'],
        })
      ).toBe('RED, BLUE');
    });

    it('maps a non-sequence to nothing rather than throwing', () => {
      expect(
        renderTemplate("{{ xs | map(attribute='id') | join(', ') }}", {})
      ).toBe('');
    });
  });

  describe('{{=json:var}}', () => {
    // Ours, not Jinja2's. It is rewritten to a filter before nunjucks sees the
    // template, so the value is inserted after parsing.
    it('stringifies an object', () => {
      expect(renderTemplate('{{=json:payload}}', { payload: { a: 1 } })).toBe(
        '{"a":1}'
      );
    });

    it('stringifies a string that is already JSON, as it always has', () => {
      expect(renderTemplate('{{=json:list}}', { list: '[{"a":1}]' })).toBe(
        '"[{\\"a\\":1}]"'
      );
    });

    it('renders an unresolved variable as an empty JSON string', () => {
      expect(renderTemplate('{{=json:missing}}', {})).toBe('""');
    });

    it('renders as null rather than throwing on a circular value', () => {
      const circular = {};
      circular.self = circular;

      expect(renderTemplate('{{=json:circular}}', { circular })).toBe('null');
    });

    it('is also available to an author as a filter', () => {
      expect(renderTemplate('{{ payload | json }}', { payload: [1, 2] })).toBe(
        '[1,2]'
      );
    });
  });

  describe('escaping', () => {
    it('leaves ampersands and angle brackets alone', () => {
      // autoescape would send the model &amp; and &lt;, which is corruption of
      // every prompt carrying a product name with an ampersand in it.
      const value = "Black & Decker <7/16\"> 'quoted'";

      expect(renderTemplate('{{ name }}', { name: value })).toBe(value);
    });
  });

  describe('undefined and null', () => {
    it('renders an unresolved variable as empty', () => {
      expect(renderTemplate('[{{ missing }}]', {})).toBe('[]');
    });

    it('renders an unresolved path as empty rather than throwing', () => {
      expect(renderTemplate('[{{ a.b.c }}]', {})).toBe('[]');
    });

    it('renders null as empty, in the engine and in the fallback alike', () => {
      // The one behaviour that moved. nunjucks renders null as empty, and the
      // fallback must agree with it or a template that fails to compile writes
      // the word "null" into the prompt where the engine wrote nothing.
      expect(renderTemplate('[{{ value }}]', { value: null })).toBe('[]');
      expect(substitute('[{{value}}]', { value: null })).toBe('[]');
    });
  });

  describe('values are data, never markup', () => {
    it('does not interpret template syntax inside a value', () => {
      // The pre-#655 renderer substituted {{=json:}} first and {{var}} second,
      // so a value carrying {{x}} was rewritten by the second pass. Model
      // output reaches these variables.
      expect(
        renderTemplate('{{ description }}', {
          description: 'Use {{ secret }} and {% raw %}',
          secret: 'leaked',
        })
      ).toBe('Use {{ secret }} and {% raw %}');
    });
  });

  describe('a template that will not render', () => {
    it('falls back to substitution rather than throwing', () => {
      const log = logger();

      const text = renderTemplate(
        'Generate {{count}} products.\n{% if brand %}\nBrand: {{brand}}',
        { brand: 'Solara', count: 5 },
        { logger: log, name: 'product' }
      );

      expect(text).toContain('Generate 5 products.');
      expect(text).toContain('Brand: Solara');
      // The fallback is the pre-#655 renderer, so the unclosed tag is still in
      // the text the model receives - degraded exactly as far as #643 and no
      // further, which is the trade for not killing a running generation.
      expect(text).toContain('{% if brand %}');
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error.mock.calls[0][1]).toMatchObject({ name: 'product' });
    });

    it('names the prompt in the log so the typo can be found', () => {
      const log = logger();

      renderTemplate('{% if %}', {}, { logger: log, name: 'warehouse' });

      const [message, meta] = log.error.mock.calls[0];

      expect(message).toMatch(/template failed to render/i);
      expect(meta.name).toBe('warehouse');
      expect(meta.message).toBeTruthy();
    });

    it('survives a template with no logger at all', () => {
      expect(() => renderTemplate('{% if %}', {})).not.toThrow();
    });

    it('cannot read a file off the server', () => {
      const log = logger();

      // No loader is configured, so an imported prompt cannot pull a file into
      // the text sent to the model - `package.json` is chosen because it is
      // certain to exist next to the process and would be unmistakable in the
      // output. Failing is the point; what the model receives is the
      // fallback's output, which carries the include tag verbatim.
      const text = renderTemplate(
        '{% include "package.json" %}ok',
        {},
        { logger: log, name: 'account' }
      );

      expect(text).not.toContain('"dependencies"');
      expect(text).toContain('ok');
      expect(log.error).toHaveBeenCalled();
    });

    it('bounds a runaway loop instead of hanging the run', () => {
      const log = logger();

      const text = renderTemplate(
        '{% for i in range(0, 100000000) %}x{% endfor %}done',
        {},
        { logger: log, name: 'pricing' }
      );

      // A hundred million iterations never start: the bound throws, so the
      // render fails in milliseconds and the fallback answers instead of a
      // worker sitting on the prompt.
      expect(text).toContain('done');
      expect(text).not.toContain('xxx');
      expect(log.error.mock.calls[0][1].message).toContain('the limit is');
    });

    it('still renders a loop within the limit', () => {
      expect(
        renderTemplate('{% for i in range(3) %}{{ i }}{% endfor %}', {})
      ).toBe('012');
    });

    it('survives unbounded recursion', () => {
      const log = logger();

      const text = renderTemplate(
        '{% macro again(n) %}{{ again(n + 1) }}{% endmacro %}{{ again(1) }}after',
        {},
        { logger: log, name: 'order' }
      );

      expect(text).toContain('after');
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe('whitespace', () => {
    it('collapses the gap an empty block leaves behind', () => {
      // Added in #643 for composed blocks that resolve to nothing, and a
      // conditional whose branch is not taken has the same shape.
      expect(
        renderTemplate('a\n\n{{ first }}\n\n{{ second }}\n\nb', {
          first: '',
          second: '',
        })
      ).toBe('a\n\nb');
    });
  });

  describe('through the service', () => {
    it('renders a prompt file and names it when one fails', async () => {
      const service = new PromptService({ logger: logger() });

      const text = await service.render('names', {
        brandGuidance: '',
        categoryList: 'Tools',
        count: 3,
        pluralSuffix: 's',
        vocabularyGuidance: '',
      });

      expect(text).toContain('Produce 3 distinct product names');
      expect(text).not.toMatch(/\{\{|\{%/);
    });

    it('passes the prompt name into the failure log', () => {
      const log = logger();
      const service = new PromptService({ logger: log });

      service.renderFromString('{% endif %}', {}, 'pdf');

      expect(log.error.mock.calls[0][1].name).toBe('pdf');
    });
  });
});
