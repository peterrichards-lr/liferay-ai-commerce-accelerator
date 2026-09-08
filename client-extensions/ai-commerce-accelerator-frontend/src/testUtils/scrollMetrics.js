/**
 * happy-dom performs no layout, so `scrollHeight` is 0 on every element and
 * assigning `scrollTop` records nothing. That makes "scroll to the bottom"
 * indistinguishable from "scroll to the top" - exactly the distinction the
 * console auto-scroll tests exist to check - so both are stubbed here and
 * every assignment is recorded.
 */
export function stubScrollMetrics(scrollHeight = 1000) {
  const positions = [];
  const originals = ['scrollHeight', 'scrollTop'].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
  ]);

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get: () => positions[positions.length - 1] ?? 0,
    set: (value) => {
      positions.push(value);
    },
  });

  return {
    positions,
    scrollHeight,
    lastPosition: () => positions[positions.length - 1],
    restore() {
      for (const [name, descriptor] of originals) {
        // A descriptor inherited from Element.prototype rather than owned by
        // HTMLElement.prototype has to be removed, not redefined.
        if (descriptor) {
          Object.defineProperty(HTMLElement.prototype, name, descriptor);
        } else {
          delete HTMLElement.prototype[name];
        }
      }
    },
  };
}
