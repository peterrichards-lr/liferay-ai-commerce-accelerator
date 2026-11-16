import { describe, it, expect } from 'vitest';
import { DEFAULTS } from './defaults';
import AI_MODELS from './ai-models.json';

describe('DEFAULTS.aiModel', () => {
  // The microservice refuses a model outside its list. A fixed default that
  // the list stops naming refuses every dashboard generation, which is how
  // gpt-4o-mini went unnoticed from #969 until #1390.
  it('is unset, or a model the shipped list still names', () => {
    const models = AI_MODELS.map((model) => model.value);

    expect([null, ...models]).toContain(DEFAULTS.aiModel);
  });
});
