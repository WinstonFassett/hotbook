# Theming System for Vizform Charts

This document describes the hybrid CSS vars + reactive cells theming pattern used in Vizform charts, starting with bar-chart on CartesianChartBase.

## Overview

The theming system combines:
1. **Reactive cells** for all geometry and color constants
2. **CSS variable sync** via `biEffect()` to read theme colors from CSS
3. **Fallback values** when CSS variables are not defined

This pattern allows charts to:
- Respond to runtime theme changes (e.g., dark mode toggle)
- Support tweaks panel sliders for geometry adjustments
- Override colors via inline styles or CSS variables
- Maintain smooth reactivity without DOM thrashing

## Implementation Pattern

### 1. Geometry Cells

Replace all hardcoded geometry constants with reactive cells:

```typescript
// Before:
const V_PAD = { top: 16, right: 24, bottom: 36, left: 48 };
const H_PAD = { top: 16, right: 64, bottom: 36, left: 16 };
const V_BAR_STEP = 56;
const LABEL_PAD = 8;

// After:
private paddingTopCell = cell(16);
private paddingRightVerticalCell = cell(24);
private paddingRightHorizontalCell = cell(64);
private paddingBottomCell = cell(36);
private paddingLeftVerticalCell = cell(48);
private paddingLeftHorizontalCell = cell(16);
private barStepVerticalCell = cell(56);
private labelPaddingCell = cell(8);
```

### 2. Color Cells with CSS Variable Sync

Define color cells and sync them with CSS variables in `connectedCallback()`:

```typescript
// Color cell with default fallback value
private accentColorCell = cell("#7aaae8");

connectedCallback() {
  super.connectedCallback();

  // CSS var sync: read --color-accent from CSS
  biEffect(() => {
    if (typeof window === "undefined" || !this.isConnected) return;
    const style = window.getComputedStyle(this);
    const accent = style.getPropertyValue('--color-accent').trim();
    if (accent) this.accentColorCell.value = accent;
  });
}
```

### 3. CSS Variable Usage in Styles

Use CSS variables with fallbacks in injected CSS:

```typescript
const BAR_CSS = `
[data-focusable]:focus {
  outline: 2px solid var(--color-focus, #4a9eff);
  outline-offset: 2px;
}
`;
```

### 4. Using Cells in Rendering

Reference cell values in `_setupRendering()` via derive cells:

```typescript
protected _setupRendering(): void {
  // Create derived padding based on orientation
  const V_PAD = derive(() => ({
    top: this.paddingTopCell.value,
    right: this.paddingRightVerticalCell.value,
    bottom: this.paddingBottomCell.value,
    left: this.paddingLeftVerticalCell.value
  }));

  const H_PAD = derive(() => ({
    top: this.paddingTopCell.value,
    right: this.paddingRightHorizontalCell.value,
    bottom: this.paddingBottomCell.value,
    left: this.paddingLeftHorizontalCell.value
  }));

  const PAD = derive(() => isVert.value ? V_PAD.value : H_PAD.value);

  // Use in layout calculations
  const plotX = derive(() => PAD.value.left);
  const plotW = derive(() => Wc.value - PAD.value.left - PAD.value.right);
}
```

## CSS Variables

Charts should support these standard CSS variables:

| Variable | Purpose | Default Fallback |
|----------|---------|------------------|
| `--color-accent` | Primary accent color for bars/marks | `#7aaae8` |
| `--color-focus` | Focus outline color | `#4a9eff` |

Future charts may extend this list with additional theme variables.

## Benefits

### Reactive Updates
- Geometry cells can be updated from tweaks panels
- Changes propagate through derive chains automatically
- CSS transitions handle smooth visual updates

### CSS Integration
- Colors sync from CSS variables via `getComputedStyle()`
- Supports dark mode via CSS custom property changes
- Inline style overrides work: `<md-bar-chart style="--color-accent: red">`

### Performance
- `biEffect()` runs only when cells change or CSS re-computes
- No polling or manual observation
- Browser handles CSS variable inheritance

## Implementation Checklist

For each new Cartesian chart:

- [ ] Define geometry cells for all constants (padding, spacing, steps)
- [ ] Define color cells with default fallbacks
- [ ] Add CSS var sync in `connectedCallback()` with `biEffect()`
- [ ] Replace hardcoded constants in `_setupRendering()` with cell references
- [ ] Update injected CSS to use `var(--color-*, fallback)`
- [ ] Test with tweaks panel (geometry changes)
- [ ] Test with CSS var overrides (inline style)
- [ ] Test dark mode toggle
- [ ] Verify no visual regressions

## Example: Bar Chart

See `packages/bireactive/src/charts/bar-chart.ts` for the reference implementation of this pattern on CartesianChartBase.
