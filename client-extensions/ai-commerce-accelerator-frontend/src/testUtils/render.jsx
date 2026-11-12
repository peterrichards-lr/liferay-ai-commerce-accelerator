import { ClayIconSpriteContext } from '@clayui/icon';
import { render as renderUnwrapped } from '@testing-library/react';

export * from '@testing-library/react';

/**
 * The spritemap the app is given in production. The fragment passes
 * `themeDisplay`'s spritemap as an attribute and AppProvider supplies it
 * through ClayIconSpriteContext. A component rendered on its own in a test has
 * no AppProvider above it, so every ClayIcon warned that it had no spritemap:
 * 241 of the 258 stderr blocks a passing run printed (#1352).
 *
 * Tests that render through AppProvider pass this in their config instead,
 * because AppProvider's own context would override a wrapper's.
 */
export const TEST_SPRITEMAP = '/icons.svg';

function SpritemapProvider({ children }) {
  return (
    <ClayIconSpriteContext.Provider value={TEST_SPRITEMAP}>
      {children}
    </ClayIconSpriteContext.Provider>
  );
}

export function render(ui, options) {
  return renderUnwrapped(ui, { wrapper: SpritemapProvider, ...options });
}
