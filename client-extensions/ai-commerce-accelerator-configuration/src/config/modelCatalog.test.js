import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_OPTIONS,
  defaultModelForProvider,
  inferProvider,
  modelProviderIssue,
  modelsForProvider,
} from './modelCatalog';

const require = createRequire(import.meta.url);

describe('modelCatalog', () => {
  it('shows only the selected provider models', () => {
    expect(
      modelsForProvider(DEFAULT_MODEL_OPTIONS, 'anthropic').map((m) => m.value)
    ).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
  });

  it('keeps a custom entry visible for every provider', () => {
    const options = [...DEFAULT_MODEL_OPTIONS, { value: 'custom-llm' }];
    expect(modelsForProvider(options, 'gemini').map((m) => m.value)).toContain(
      'custom-llm'
    );
  });

  it('reports a cross-provider pairing', () => {
    expect(
      modelProviderIssue('gemini', 'claude-opus-5', DEFAULT_MODEL_OPTIONS)
    ).toMatch(/Google Gemini cannot run/);
  });

  it('stays silent on a matching pairing', () => {
    expect(
      modelProviderIssue('openai', 'gpt-4o', DEFAULT_MODEL_OPTIONS)
    ).toBeNull();
  });

  it('swaps the default when the provider changes', () => {
    expect(
      defaultModelForProvider(DEFAULT_MODEL_OPTIONS, 'anthropic', 'gpt-4o')
    ).toBe('claude-opus-5');
  });

  it('attributes models the same way as the microservice', () => {
    const microservice = require('../../../ai-commerce-accelerator-microservice/utils/modelCatalog.cjs');

    // These are separate packages with different module systems, so the shared
    // behaviour is asserted rather than imported.
    expect(DEFAULT_MODEL_OPTIONS).toEqual(microservice.DEFAULT_MODEL_OPTIONS);

    for (const id of [
      'claude-opus-5',
      'gpt-4o-mini',
      'o3-mini',
      'gemini-2.5-pro',
      'my-self-hosted-llm',
    ]) {
      expect(inferProvider(id)).toBe(microservice.inferProvider(id));
    }

    expect(
      modelProviderIssue('anthropic', 'gpt-4o-mini', DEFAULT_MODEL_OPTIONS)
    ).toBe(
      microservice.modelProviderIssue(
        'anthropic',
        'gpt-4o-mini',
        DEFAULT_MODEL_OPTIONS
      )
    );
  });

  it('matches the batch seed', () => {
    const seed = require('../../../ai-commerce-accelerator-batch/batch/19-object-entry-ai-model-options.batch-engine-data.json');
    expect(JSON.parse(seed.items[0].configValue)).toEqual(
      DEFAULT_MODEL_OPTIONS
    );
  });
});
