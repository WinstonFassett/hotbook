# Visual Theming Guide

Vizform charts support visual theming through a hybrid approach:
- **CSS custom properties** for colors (browser-native, works with dark mode)
- **Reactive cells** for geometry values that drive layout math

## Hierarchical Charts

The hierarchical chart family (icicle, pack, sunburst, treemap, treetable) shares theming through `HierarchicalChartBase`.

### CSS Custom Properties (Colors)

Override these CSS variables on the chart element or any ancestor:

```css
/* Focus outline color */
--color-focus: #fff;

/* Hover outline color */
--color-hover: #c8cdd6;

/* Default tile/arc stroke color */
--color-tile-stroke: #0b0d12;

/* Tile/arc stroke color for root/depth-0 nodes */
--color-tile-stroke-root: #444;
```

**Example usage:**

```html
<style>
  /* Apply to all hierarchical charts */
  vf-icicle-chart,
  vf-pack-chart,
  vf-sunburst-chart,
  vf-treemap-chart {
    --color-focus: #4a9eff;
    --color-hover: #a8c5e8;
    --color-tile-stroke: #1a1d24;
    --color-tile-stroke-root: #666;
  }

  /* Dark mode overrides */
  @media (prefers-color-scheme: dark) {
    vf-treemap-chart {
      --color-focus: #fff;
      --color-tile-stroke: #0b0d12;
    }
  }
</style>

<vf-treemap-chart></vf-treemap-chart>
```

### Reactive Geometry Cells

For programmatic theming (tweaks panels, runtime configuration), import and modify the reactive cells:

```typescript
import { hierarchicalTheme } from 'bireactive/hierarchical/theming';

// Adjust tile padding (treemap group headers)
hierarchicalTheme.tilePadding.value = 20; // default: 16

// Adjust label font size
hierarchicalTheme.fontSize.value = 12; // default: 11

// Adjust stroke width multiplier
hierarchicalTheme.strokeWidthBase.value = 1.5; // default: 1

// Adjust arc padding (sunburst/radial layouts)
hierarchicalTheme.arcPadding.value = 2; // default: 1

// Override colors programmatically (CSS vars preferred)
hierarchicalTheme.focusColor.value = '#4a9eff';
hierarchicalTheme.hoverColor.value = '#a8c5e8';
hierarchicalTheme.tileStroke.value = '#1a1d24';
hierarchicalTheme.tileStrokeRoot.value = '#666';
```

**Reset to defaults:**

```typescript
import { resetHierarchicalThemeToDefaults } from 'bireactive/hierarchical/theming';

resetHierarchicalThemeToDefaults();
```

### Affected Charts

All hierarchical charts inherit theming from `HierarchicalChartBase`:

- **icicle-chart** — Horizontal or vertical icicle partition
- **pack-chart** — Circle-packing hierarchy
- **sunburst-chart** — Radial partition (zoomable sunburst)
- **treemap-chart** — Squarified treemap
- **treetable-chart** — Table-based hierarchy view

### Architecture Notes

**CSS var sync:** The base class (`HierarchicalChartBase`) calls `syncCssVarsToTheme()` in `connectedCallback`, which reads CSS custom properties via `getComputedStyle()` and writes them to the color cells. This happens per chart instance, so CSS overrides on specific elements work correctly.

**Motion separation:** The `motion.separation` cell (from `runtime-config.ts`) controls visual separation between marks. It's shared across all hierarchical charts and drives:
- Sunburst arc stroke width
- Treemap `paddingInner` / `paddingOuter`
- Pack circle border thickness
- Icicle gaps

**Tile padding:** The `hierarchicalTheme.tilePadding` cell controls the fixed-pixel group header space in treemap layouts (d3's `paddingTop`). When drilling, this padding is reclaimed from the vertical scale to prevent empty header bars in deeply zoomed views.

## Motion / Animation

Motion timing is controlled by the `motion` cells (separate from theming):

```typescript
import { motion } from 'bireactive/lib/runtime-config';

motion.hoverMs.value = 100;   // Hover/focus micro-feedback
motion.motionMs.value = 300;  // Layout transitions (drill, config changes)
motion.separation.value = 1;  // Visual separation between marks (px)
```

See `packages/bireactive/src/lib/runtime-config.ts` for details.

## Browser Support

CSS custom properties work in all modern browsers. Fallback values are provided for browsers that don't support custom properties (e.g., `var(--color-focus, #fff)`).

## Related

- `packages/bireactive/src/hierarchical/theming.ts` — Hierarchical theming cells
- `packages/bireactive/src/lib/runtime-config.ts` — Motion timing cells
- `packages/bireactive/src/lib/motion-tweaks-panel.ts` — Dev UI for tweaking cells
