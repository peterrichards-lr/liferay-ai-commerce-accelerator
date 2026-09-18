import React from 'react';
import { render, screen } from '@testing-library/react';

import AiConfigPanel from './AiConfigPanel';

/**
 * The Core AI Model dropdown, which is the one list the model catalogue fills.
 *
 * Two things it now has to get right, both invisible from a vendor's model
 * name: an image model must not be offerable as the Core AI Model (#637), and
 * an operator picking between three models must be able to see which is the
 * cheap one (#636).
 */
const STORE = {
  'ai-model-options': [
    {
      label: 'Claude Opus 5',
      value: 'claude-opus-5',
      provider: 'anthropic',
      tier: 'premium',
      text: true,
      images: false,
    },
    {
      label: 'Claude Haiku 4.5',
      value: 'claude-haiku-4-5',
      provider: 'anthropic',
      tier: 'cheap',
      text: true,
      images: false,
    },
    // No tier: this build could not rank it, and must not pretend otherwise.
    {
      label: 'Claude Fable 5.1',
      value: 'claude-fable-5-1',
      provider: 'anthropic',
      tier: null,
      text: true,
      images: false,
    },
    // Named like an image model and carrying no modality fields, so only the
    // name keeps it out.
    {
      label: 'Nano Banana Pro',
      value: 'nano-banana-pro-preview',
      provider: 'anthropic',
    },
  ],
};

let aiConfig = {};

// Stored values have to keep their identity across renders. The panel
// recomputes its warnings in an effect keyed on them, so a mock handing back a
// fresh object each render would re-run the effect forever.
const stored = new Map();

vi.mock('../../hooks', () => ({
  useCodeMirrorRefresh: vi.fn(() => vi.fn()),
  useForm: vi.fn(),
  useObjectStorage: vi.fn(({ keys, defaults }) => {
    const id = keys.join('|');
    if (!stored.has(id)) {
      stored.set(
        id,
        Object.fromEntries(
          keys.map((key) => [
            key,
            key === 'ai-config'
              ? { ...defaults[key], ...aiConfig }
              : (STORE[key] ?? defaults[key]),
          ])
        )
      );
    }

    return {
      loading: false,
      saving: false,
      values: stored.get(id),
      dirty: false,
      onSave: vi.fn(),
      onCancel: vi.fn(),
      setValue: vi.fn(),
    };
  }),
}));

vi.mock('../../utils/editor', () => ({
  defaultEditorOptions: {},
  ensureLiferayCodeMirrorCss: vi.fn(),
}));

vi.mock('react-codemirror2', () => ({
  Controlled: ({ value }) => <textarea readOnly value={value} />,
}));

const modelOptions = () =>
  [...document.querySelectorAll('#default-model option')].map((option) => [
    option.textContent,
    option.value,
  ]);

describe('AiConfigPanel model choices', () => {
  beforeEach(() => {
    stored.clear();
    aiConfig = { provider: 'anthropic', defaultModel: 'claude-opus-5' };
  });

  it('annotates each model with the tier it was ranked into', () => {
    render(<AiConfigPanel />);

    expect(modelOptions()).toContainEqual([
      'Claude Haiku 4.5 (cheap)',
      'claude-haiku-4-5',
    ]);
    expect(modelOptions()).toContainEqual([
      'Claude Opus 5 (premium)',
      'claude-opus-5',
    ]);
  });

  it('leaves a model it could not rank unannotated rather than guessing', () => {
    render(<AiConfigPanel />);

    expect(modelOptions()).toContainEqual([
      'Claude Fable 5.1',
      'claude-fable-5-1',
    ]);
  });

  it('never offers an image model as the Core AI Model', () => {
    render(<AiConfigPanel />);

    expect(modelOptions().map(([, value]) => value)).not.toContain(
      'nano-banana-pro-preview'
    );
  });

  it('reports one that is already configured', () => {
    // A stored configuration is not rewritten silently: the model stays
    // selected and the panel says why it cannot work.
    aiConfig = {
      provider: 'anthropic',
      defaultModel: 'nano-banana-pro-preview',
    };
    render(<AiConfigPanel />);

    expect(screen.getByText(/generates images, not text/)).toBeInstanceOf(
      HTMLElement
    );
  });

  it('stays quiet about a text model', () => {
    render(<AiConfigPanel />);

    expect(screen.queryByText(/generates images, not text/)).toBeNull();
  });
});
