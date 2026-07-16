## UI/UX Standards & Layout Real-Estate

The user interface must reflect a premium, professional standard, characterized by:

1.  **Horizontal Space Optimization**: Prefer multi-column grids (e.g., the 2-column generator settings) to minimize vertical scrolling on desktop.
2.  **Information Density**: Use compact card layouts and high-fidelity components like the `OverallProgressGauge` and `SystemStatus` strip to provide maximum data with minimal clutter.
3.  **Interactive States**: Use button groups, toggles, and range sliders for configuration parameters to provide immediate visual feedback.
4.  **Sticky Context**: Key navigation and configuration elements should be sticky on large screens to maintain accessibility during long generation runs.

---## Liferay Stylebook Compatibility Patterns

Empirical testing across DXP 2024.Qx and 2025.Q1 environments has revealed critical stability constraints for Stylebook client extensions:

### 1. The "Zero-Warning" Import Rule

Liferay strictly validates the `themeId` field in the Stylebook's `style-book.json`.

- **The Finding**: Even when targeting the standard "Classic" theme, explicitly setting `"themeId": "classic"` frequently triggers a "different from default theme" warning during import.
- **The Solution**: Set **`"themeId": ""`** (empty string). This bypasses the validation mismatch and allows for a clean, warning-free import into any site.

### 2. Sidebar Crash Avoidance (`defaultValue` Error)

The Liferay Stylebook Sidebar (the visual property editor) will crash with a fatal JavaScript error (`TypeError: Cannot read properties of undefined (reading 'defaultValue')`) if it encounters a token value in `frontend-tokens-values.json` that does not have a corresponding definition in the DXP theme's internal schema.

- **The Rule**: **NEVER** include unmapped custom token keys (e.g., `brand-color-1`) or complex font stacks in the JSON file.
- **The Pattern**: Use the **Liferay Token Mapping structure** to ensure tokens are correctly mapped to CSS variables and visible in the Sidebar property editor:

  ```json
  {
    "primaryColor": {
      "cssVariableMapping": "primary",
      "value": "#0053f0"
    },
    "brandColor1": {
      "cssVariableMapping": "brand-color-1",
      "value": "#00d1ff"
    }
  }
  ```

- **The Alpha/Reference Guard**: DXP supports `rgba()`, `transparent`, and cross-token references (using the `"name": "tokenName"` key within the value object).

### 3. CSS-Autority Theming

Because the Stylebook zip is an unreliable carrier for custom brand tokens:

- **Mandatory Pattern**: Define all "High-End" brand colors (e.g., Electric Cyan, Vivid Purple) and typography defaults directly in the project's **SCSS (`app.scss`)** as CSS variables or hardcoded fallbacks.
- **Rationale**: This ensures the application looks premium immediately upon deployment (hosted inside or outside Liferay) without requiring a fragile token-mapping step in the DXP UI.

### 4. Custom Accent Color & Form Control Synchronization

To ensure exact color parity between the DXP Stylebook and browser-rendered form controls:

- **`accent-color` Authority**: Always apply `accent-color: var(--aica-primary-authority) !important` to the dashboard root. This forces native checkboxes and radio buttons to follow the theme's primary color.
- **Range Slider "Shadow-Fill" Trick**: Browser-default range sliders often resist standard coloring for the "progress" (left) side of the thumb.
  - **The Pattern**: Use a combination of `overflow: hidden` on the input and a massive `box-shadow` on the thumb (`box-shadow: -100vw 0 0 100vw var(--aica-primary-authority) !important`).
  - **Vendor Hardening**: Explicitly style `::-webkit-slider-runnable-track` and `::-webkit-slider-thumb` to bypass Liferay's default global CSS.
- **Spacing & Alignment**: Custom checkboxes (W3C pattern) should use `display: flex`, `align-items: flex-start`, and a minimum `gap: 1.5rem` to ensure high-end spacing and perfect vertical alignment with multi-line labels.

---
