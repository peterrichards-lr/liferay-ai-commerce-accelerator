import React, { useEffect } from 'react';
import { render } from '@testing-library/react';
import { useCodeMirrorRefresh } from './useCodeMirrorRefresh';

// happy-dom (like jsdom) has no layout engine: every getBoundingClientRect is
// 0x0 and no ResizeObserver ever fires on its own. So these tests cannot prove
// that the refresh lands after the browser has laid the container out - only
// that the hook asks the right questions and calls refresh() exactly when the
// answers say the container has a box. The layout timing itself is only
// observable in a real browser.
const controlObservers = () => {
  const state = { disconnects: 0, frames: [], observed: [], resize: null };

  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback) {
        state.resize = callback;
      }
      observe(element) {
        state.observed.push(element);
      }
      disconnect() {
        state.disconnects += 1;
      }
    }
  );

  vi.stubGlobal('requestAnimationFrame', (callback) => {
    state.frames.push(callback);
    return state.frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());

  return state;
};

const fakeEditor = () => {
  const wrapper = document.createElement('div');
  let box = { height: 0, width: 0 };

  wrapper.getBoundingClientRect = () => ({ ...box });

  return {
    editor: {
      getWrapperElement: () => wrapper,
      refresh: vi.fn(),
    },
    resizeTo: (width, height) => {
      box = { height, width };
    },
  };
};

function Harness({ editor }) {
  const refreshOnLayout = useCodeMirrorRefresh();

  useEffect(() => {
    refreshOnLayout(editor);
  }, [editor, refreshOnLayout]);

  return null;
}

describe('useCodeMirrorRefresh', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not refresh while the container has no box to measure', () => {
    const observers = controlObservers();
    const { editor } = fakeEditor();

    render(<Harness editor={editor} />);

    observers.frames.forEach((frame) => frame());
    observers.resize?.();

    // Refreshing here would only cache another set of wrong metrics.
    expect(editor.refresh).not.toHaveBeenCalled();
  });

  it('refreshes once the container reports a size', () => {
    const observers = controlObservers();
    const { editor, resizeTo } = fakeEditor();

    render(<Harness editor={editor} />);

    resizeTo(640, 300);
    observers.resize();

    expect(editor.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes on the first frame when layout is already settled', () => {
    const observers = controlObservers();
    const { editor, resizeTo } = fakeEditor();

    resizeTo(640, 300);
    render(<Harness editor={editor} />);

    observers.frames.forEach((frame) => frame());

    expect(editor.refresh).toHaveBeenCalledTimes(1);
  });

  it('ignores the resize its own refresh provokes', () => {
    const observers = controlObservers();
    const { editor, resizeTo } = fakeEditor();

    render(<Harness editor={editor} />);

    resizeTo(640, 300);
    observers.resize();
    // The observer reports the box refresh() just settled on. Acting on that
    // would refresh forever.
    observers.resize();

    expect(editor.refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes again when a late stylesheet changes the box', () => {
    const observers = controlObservers();
    const { editor, resizeTo } = fakeEditor();

    render(<Harness editor={editor} />);

    resizeTo(640, 18);
    observers.resize();

    // The CodeMirror stylesheet arrives and gives the editor its real height,
    // which invalidates the metrics measured a moment ago.
    resizeTo(640, 300);
    observers.resize();

    expect(editor.refresh).toHaveBeenCalledTimes(2);
  });

  it('stops observing when the editor goes away', () => {
    const observers = controlObservers();
    const { editor } = fakeEditor();

    const { unmount } = render(<Harness editor={editor} />);

    expect(observers.observed).toHaveLength(1);

    unmount();

    expect(observers.disconnects).toBe(1);
  });

  it('tolerates an editor it cannot measure or refresh', () => {
    controlObservers();

    expect(() => render(<Harness editor={{}} />)).not.toThrow();
    expect(() => render(<Harness editor={null} />)).not.toThrow();
  });
});
