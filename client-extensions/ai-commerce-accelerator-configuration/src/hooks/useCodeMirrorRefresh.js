import { useCallback, useEffect, useRef } from 'react';

// CodeMirror 5 measures its container the moment it is constructed, caches the
// character metrics it reads there, and draws nothing usable when that
// container has no real box yet. Every editor in this application mounts in
// exactly that state: the panels are code-split, and the CodeMirror stylesheet
// is injected by an effect that runs *after* the editors in the same commit
// have already mounted, so the very first measurement is taken against an
// unstyled container. That is why a JSON or prompt box is blank on arrival and
// correct after a remount - by then the stylesheet has landed.
//
// refresh() re-measures and repaints, so the fix is not what to call but when
// to call it. Mount is demonstrably too early, which is why this keys off
// layout instead: a ResizeObserver on the editor's own wrapper fires when the
// box actually changes - when the late stylesheet applies, when the code-split
// chunk is first laid out, when the window or the side navigation resizes -
// and each of those is precisely a moment when the cached metrics went stale.

const measure = (element) => {
  const { width, height } = element.getBoundingClientRect();

  // A zero box means the container is not laid out (or is display:none).
  // There is nothing to measure against yet, so leave it to a later
  // observation rather than caching another set of wrong metrics.
  return width > 0 || height > 0 ? { height, width } : null;
};

export const useCodeMirrorRefresh = () => {
  const disposeRef = useRef(null);

  useEffect(
    () => () => {
      disposeRef.current?.();
      disposeRef.current = null;
    },
    []
  );

  return useCallback((editor) => {
    disposeRef.current?.();
    disposeRef.current = null;

    const wrapper = editor?.getWrapperElement?.();

    if (typeof editor?.refresh !== 'function' || !wrapper) {
      return;
    }

    // The box that produced the metrics the editor is currently using.
    let measured = null;

    const refreshIfResized = () => {
      const box = measure(wrapper);

      if (
        !box ||
        (measured &&
          box.width === measured.width &&
          box.height === measured.height)
      ) {
        return;
      }

      measured = box;
      editor.refresh();

      // refresh() can change the wrapper's own height, which the observer
      // reports back to us. Adopting the resulting box as the baseline makes
      // that echo a no-op, so the observer cannot feed itself.
      measured = measure(wrapper) || measured;
    };

    // Layout for this commit is not settled in the mount tick, so take the
    // first measurement on the next frame.
    const frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(refreshIfResized)
        : null;

    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(refreshIfResized)
        : null;

    observer?.observe(wrapper);

    disposeRef.current = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      observer?.disconnect();
    };
  }, []);
};
