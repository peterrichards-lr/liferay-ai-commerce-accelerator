import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_OPTIONS,
  defaultModelForProvider,
  inferModality,
  inferProvider,
  modelModality,
  modelModalityIssue,
  modelProviderIssue,
  modelTier,
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

  it('keeps an image model out of the Core AI Model list', () => {
    // The catalogue feeds exactly one dropdown and it is the text one, so an
    // image model reaching it fails every generateJSON call (#637).
    const options = [
      ...DEFAULT_MODEL_OPTIONS,
      { label: 'Pro Image', value: 'gemini-3-pro-image', provider: 'gemini' },
    ];

    expect(
      modelsForProvider(options, 'gemini').map((m) => m.value)
    ).not.toContain('gemini-3-pro-image');
  });

  it('reports an image model chosen as the core model', () => {
    expect(modelModalityIssue('nano-banana-pro-preview', [])).toMatch(
      /generates images, not text/
    );
  });

  it('reads a tier off an entry and null off one it could not rank', () => {
    expect(modelTier(DEFAULT_MODEL_OPTIONS[3])).toBe('premium');
    expect(modelTier({ value: 'gpt-6-astra', tier: null })).toBeNull();
  });

  it('judges modality the same way as the microservice', () => {
    const microservice = require('../../../ai-commerce-accelerator-microservice/utils/modelCatalog.cjs');

    for (const id of [
      'gpt-image-2',
      'dall-e-3',
      'imagen-3.0-generate-002',
      'gemini-3-pro-image',
      'nano-banana-pro-preview',
      'gemini-3.8-flash',
      'my-self-hosted-llm',
    ]) {
      expect(inferModality(id)).toEqual(microservice.inferModality(id));
      expect(modelModality({ value: id })).toEqual(
        microservice.modelModality({ value: id })
      );
      expect(modelModalityIssue(id, [])).toBe(
        microservice.modelModalityIssue(id, [])
      );
    }
  });

  it('matches ai-models.json, the batch generation source', () => {
    // Gradle generateBatchFiles builds the batch seed from this file, so it is
    // the source of truth rather than the generated batch entry.
    const source = require('../../../ai-commerce-accelerator-frontend/src/config/ai-models.json');
    expect(source).toEqual(DEFAULT_MODEL_OPTIONS);
  });
});
