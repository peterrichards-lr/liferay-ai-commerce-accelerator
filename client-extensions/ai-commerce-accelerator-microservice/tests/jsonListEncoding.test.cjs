const fs = require('fs');
const path = require('path');
const { cases } = require('./fixtures/promptCorpus.cjs');
const { PromptService } = require('../services/promptService.cjs');

/**
 * The three list variables must be encoded exactly once.
 *
 * `aiService` used to hand them over already stringified, and the prompt then
 * applied `{{=json:}}` to the result, so every order, pricing, promotion and
 * PDF generation sent the model a quoted, backslash-escaped document instead of
 * readable JSON - roughly a third more characters for the same content (#1021).
 *
 * Nothing downstream inspects a prompt, so neither half of this shows up at
 * runtime. It is held here from both ends: the source may not re-introduce the
 * encoding, and the prompts may not drop the filter that performs it. Dropping
 * the filter is the inverse defect - the value would render as `[object
 * Object]` - so both directions are failures and both are pinned.
 */

const JSON_LIST_VARS = [
  'accountListJSON',
  'productListJSON',
  'specificationsJSON',
];

const AI_SERVICE = path.join(__dirname, '..', 'services', 'aiService.cjs');
const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

const service = new PromptService({});

function readPrompt(name) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8');
}

const promptFiles = fs
  .readdirSync(PROMPTS_DIR)
  .filter((file) => file.endsWith('.md'))
  .map((file) => path.basename(file, '.md'));

const renderCases = [];

for (const one of cases) {
  for (const name of JSON_LIST_VARS) {
    if (one.vars[name] === undefined) {
      continue;
    }

    renderCases.push([`${one.prompt}.${one.label} ${name}`, one, name]);
  }
}

describe('the JSON list variables are encoded once', () => {
  it('aiService hands them over as values, not as strings', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const source = fs.readFileSync(AI_SERVICE, 'utf8');

    const offenders = JSON_LIST_VARS.flatMap((name) => {
      // eslint-disable-next-line security/detect-non-literal-regexp
      const assigned = new RegExp(`${name}\\s*:\\s*JSON\\.stringify`, 'g');
      const found = source.match(assigned) || [];

      return found.length ? [`${name} (${found.length})`] : [];
    });

    expect(offenders).toEqual([]);
  });

  it.each(promptFiles)(
    '%s applies the filter wherever it reads one',
    (name) => {
      const template = readPrompt(name);

      for (const variable of JSON_LIST_VARS) {
        // eslint-disable-next-line security/detect-non-literal-regexp
        const bare = new RegExp(`\\{\\{${variable}\\}\\}`, 'g');

        expect(template.match(bare)).toBeNull();
      }
    }
  );

  it.each(renderCases)(
    '%s emits parseable JSON rather than a quoted string',
    (_id, one, name) => {
      const value = one.vars[name];
      const rendered = service.renderFromString(
        readPrompt(one.prompt),
        one.vars,
        one.prompt
      );

      // What the filter emits for a value it is given.
      expect(rendered).toContain(JSON.stringify(value));

      // What it emitted while the value arrived pre-stringified. The inner
      // form is the exact one aiService used, so this fails the moment it
      // comes back.
      expect(rendered).not.toContain(
        JSON.stringify(JSON.stringify(value, null, 2))
      );
    }
  );
});
