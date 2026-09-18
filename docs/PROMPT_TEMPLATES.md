# Prompt Templates

Every generator renders a template from `prompts/` before it calls a model. The
templates are editable in the **AI Commerce Accelerator Configuration** UI and
importable as files, so a prompt can be changed without a build.

The renderer is [nunjucks](https://mozilla.github.io/nunjucks/templating.html),
which is Jinja2-compatible. Anything Jinja2 describes works here unless it is
listed under [Limits](#limits) below.

## Variables

```text
Generate {{count}} {{category}} products.
```

An unresolved variable renders as nothing rather than failing, so a prompt may
refer to a variable that is not always supplied.

`{{=json:variable}}` writes the value as JSON. It predates the template engine
and still works; `{{ variable | json }}` is the same thing.

Which variables a prompt receives is decided by `services/aiService.cjs` at the
call site for that prompt. The committed prompt files are the practical
reference: a variable used in `prompts/product.md` is a variable the product
generator supplies.

## Conditionals

```text
{% if geographicContext %}
- country: {{ geographicContext.countryISOCode }}
{% else %}
- country: The two-letter ISO country code.
{% endif %}
```

Only the branch that is taken reaches the model, and a tag on a line of its own
leaves no blank line behind. `{% elif %}` is available.

Writing the condition here is the alternative to composing it in
`utils/promptContext.cjs`, which requires a commit. Several blocks are still
composed there — the vocabulary listing, the account-type guidance, the order
date window — because they build text from data rather than choose between two
fixed sentences. Those arrive as ordinary variables.

## Loops and filters

```text
{% for vocabulary in vocabularies %}
- {{ vocabulary.name }}: {{ vocabulary.categories | map(attribute='name') | join(', ') }}
{% endfor %}
```

The [standard nunjucks filters](https://mozilla.github.io/nunjucks/templating.html#builtin-filters)
are available. Two are added here:

| Filter                                  | Does                                                                                                           |
| :-------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `map(attribute='name')`, `map('upper')` | Projects a sequence, as Jinja2's `map` does. nunjucks itself ships `selectattr` and `rejectattr` but no `map`. |
| `json`                                  | Writes the value as JSON. The filter form of `{{=json:var}}`.                                                  |

## When a template is wrong

A prompt is content, and a typo in one must not stop a generation that is
already running. A template that will not compile or will not render is logged
as an error naming the prompt, and the text falls back to plain variable
substitution — which means any `{% ... %}` in it reaches the model verbatim.
The run continues; the prompt is degraded. **Check the log after editing a
prompt**: a fallback is silent from the outside.

## Limits

- **No `{% include %}`, `{% extends %}` or `{% import %}`.** A prompt is
  imported content and must not be able to read a file from the server. They
  fail to render, which means the fallback above.
- **`range()` is capped at 10,000 iterations**, so a mistyped loop fails fast
  instead of occupying a worker.
- **Output is not HTML-escaped.** `&`, `<` and `"` reach the model as written,
  which is what a prompt wants and what an HTML template would not do.
- **Three or more consecutive newlines collapse to two**, so a block that
  renders to nothing leaves no gap.

## Changing a committed prompt

`tests/promptRendering.test.cjs` renders every file in `prompts/` against
representative contexts and compares the result byte for byte with the output
committed under `tests/fixtures/prompt-corpus/`. Editing a prompt file will
fail that test, which is the point: regenerate with
`UPDATE_PROMPT_CORPUS=1 yarn test promptRendering` and review the diff as part
of the change.

Prompts edited through the configuration UI are stored in Liferay and take
precedence over the files, so they are not covered by that test.

<!-- markdownlint-disable MD049 -->

---

_Last Updated: 2026-09-18_ | _Last Reviewed: 2026-09-18_
