import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useObjectStorage } from './useObjectStorage';

const { getKeyValue } = vi.hoisted(() => ({ getKeyValue: vi.fn() }));

vi.mock('../utils/api', () => ({
  getKeyValue,
  persistConfigKey: vi.fn(),
}));

function Probe({ configKey = 'ai-prompt-product' }) {
  const { loading, values } = useObjectStorage({
    defaults: { [configKey]: '' },
    json: false,
    keys: [configKey],
  });

  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="values">{JSON.stringify(values)}</span>
    </div>
  );
}

const loading = () => screen.getByTestId('loading').textContent;
const values = () => screen.getByTestId('values').textContent;

describe('useObjectStorage loading flag', () => {
  beforeEach(() => {
    getKeyValue.mockReset();
    // The hook reaches for the global Liferay provides at runtime; the failure
    // path throws a ReferenceError without it.
    vi.stubGlobal('Liferay', { Util: { openToast: vi.fn() } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears loading once the values arrive', async () => {
    getKeyValue.mockResolvedValue('Describe the product.');

    render(<Probe />);

    await waitFor(() => expect(loading()).toBe('false'));
    expect(values()).toContain('Describe the product.');
  });

  it('clears loading when the load fails', async () => {
    getKeyValue.mockRejectedValue(new Error('object endpoint is unhappy'));

    render(<Probe />);

    await waitFor(() => expect(loading()).toBe('false'));
  });

  // The regression: the finally block was guarded by the effect's `alive`
  // flag, so a load that outlived its effect could never clear its own flag -
  // and AiPromptsPanel, the one panel that gates its editors on it, was left
  // with neither content nor an error.
  it('clears loading for a load that outlives its effect', async () => {
    const pending = new Map();
    getKeyValue.mockImplementation(
      (key) => new Promise((resolve) => pending.set(key, resolve))
    );

    const { rerender } = render(<Probe configKey="first-key" />);

    expect(loading()).toBe('true');

    // Changing the key set tears the effect down and starts a second pass,
    // which is what marks the first pass stale while it is still in flight.
    rerender(<Probe configKey="second-key" />);

    await act(async () => {
      pending.get('first-key')('a stale answer');
    });

    await waitFor(() => expect(loading()).toBe('false'));

    // The staleness guard on the data writes has to stay: a superseded
    // response must not land in state.
    expect(values()).not.toContain('a stale answer');
  });
});
