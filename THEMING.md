# Chart Theming Guide

## Overview

Vizform charts support live theming through two mechanisms:

1. **CSS Custom Properties** for colors and fonts
2. **Reactive Cells** for geometry values (padding, gaps, step sizes)

This hybrid approach allows charts to be themable without sacrificing layout reactivity.

## CSS Custom Properties (Colors)

### Available Variables

#### All Cartesian Charts (Bar, Line, Area, Scatter)
- `--color-accent` — Primary chart color (default: `#7aaae8`)
- `--color-focus` — Focus outline color (default: `#4a9eff`)
- `--color-text` — Axis labels and secondary text (default: `#888`)

### Usage

Set CSS variables on the root element or on individual chart elements:

```html
<!-- Global theme -->
<style>
  :root {
    --color-accent: #ff6b9d;
    --color-focus: #c44569;
  }
</style>

<!-- Per-chart override -->
<v-bar-chart style="--color-accent: #00d084;"></v-bar-chart>
```

### Dark Mode Support

CSS variables automatically respond to `prefers-color-scheme: dark`:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-accent: #7aaae8;
    --color-text: #999;
  }
}
```

## Reactive Cells (Geometry)

### Available Cells

#### Bar Chart
- `paddingTopCell` — Top padding (default: 16px)
- `paddingRightCell` — Right padding (default: 24px)
- `paddingBottomCell` — Bottom padding (default: 36px)
- `paddingLeftCell` — Left padding (default: varies by orientation)
- `barStepVerticalCell` — Vertical bar height in overflow (default: 56px)
- `bandStepHorizontalCell` — Horizontal band height in overflow (default: 44px)
- `labelPaddingCell` — Label inner padding (default: 8px)
- `valuePaddingCell` — Value inner padding (default: 8px)
- `valueGapCell` — Gap between label and value (default: 4px)
- `outGapCell` — Gap when popped outside bar (default: 8px)

#### Line Chart
- `paddingTopCell` — Top padding (default: 16px)
- `paddingRightCell` — Right padding (default: 24px)
- `paddingBottomCell` — Bottom padding (default: 36px)
- `paddingLeftCell` — Left padding (default: 56px)
- `lineStrokeWidthCell` — Line stroke width (default: 2px)
- `focusCircleRadiusCell` — Focus circle radius (default: 8px)
- `hoverCircleRadiusCell` — Hover indicator radius (default: 4px)
- `hoverStrokeWidthCell` — Hover circle stroke width (default: 2px)
- `selectedOuterRadiusCell` — Selected outer ring radius (default: 6px)
- `selectedInnerRadiusCell` — Selected inner dot radius (default: 3px)
- `selectedStrokeWidthCell` — Selected circle stroke width (default: 2px)

#### Area Chart
- `paddingTopCell` — Top padding (default: 16px)
- `paddingRightCell` — Right padding (default: 24px)
- `paddingBottomCell` — Bottom padding (default: 36px)
- `paddingLeftCell` — Left padding (default: 56px)
- `areaFillOpacityCell` — Area fill opacity (default: 0.3)
- `lineStrokeWidthCell` — Line stroke width (default: 2px)
- `focusCircleRadiusCell` — Focus circle radius (default: 8px)
- `hoverCircleRadiusCell` — Hover indicator radius (default: 4px)
- `hoverStrokeWidthCell` — Hover circle stroke width (default: 2px)
- `selectedOuterRadiusCell` — Selected outer ring radius (default: 6px)
- `selectedInnerRadiusCell` — Selected inner dot radius (default: 3px)
- `selectedStrokeWidthCell` — Selected circle stroke width (default: 2px)

#### Scatter Chart
- `paddingTopCell` — Top padding (default: 16px)
- `paddingRightCell` — Right padding (default: 24px)
- `paddingBottomCell` — Bottom padding (default: 36px)
- `paddingLeftCell` — Left padding (default: 48px)
- `dotRadiusCell` — Dot radius (default: 5px)
- `dotStrokeWidthCell` — Dot stroke width (default: 1px)
- `selectedRadiusCell` — Selected indicator radius (default: 9px)
- `selectedStrokeWidthCell` — Selected circle stroke width (default: 2px)

### Usage

Geometry cells are publicly accessible and can be tweaked via JavaScript or the tweaks panel:

```javascript
const chart = document.querySelector('v-bar-chart');

// Adjust padding
chart.paddingTopCell.value = 24;
chart.paddingLeftCell.value = 64;

// Adjust gaps
chart.outGapCell.value = 12;
```

Changes to geometry cells trigger reactive re-layout without full re-render.

## Tweaks Panel Integration

The tweaks panel (`motion-tweaks-panel.ts`) exposes all geometry cells with sliders, allowing live tweaking of chart layout during development and design exploration.

To enable tweaks for a chart:

```html
<motion-tweaks-panel for="my-chart"></motion-tweaks-panel>
<v-bar-chart id="my-chart"></v-bar-chart>
```

## Adding Theming to New Charts

To add theming to a new chart:

1. **Add reactive cells** to the chart class for all geometry constants:
   ```typescript
   readonly paddingTopCell = cell(DEFAULT_PADDING_TOP);
   readonly labelGapCell = cell(DEFAULT_LABEL_GAP);
   ```

2. **Read CSS vars in the scene effect**:
   ```typescript
   biEffect(() => {
     const accentColor = getCSSVar('--color-accent', DEFAULT_COLOR);
     this.accentColorCell.value = accentColor as string;
   });
   ```

3. **Replace hardcoded constants** with reactive cell references:
   ```typescript
   // Before
   const padding = { top: 16, left: 24 };

   // After
   const padding = derive(() => ({
     top: this.paddingTopCell.value,
     left: this.paddingLeftCell.value
   }));
   ```

4. **Add CSS variables** to `theme.css`:
   ```css
   :root {
     --color-accent: #7aaae8;
   }
   ```

## Testing

To verify theming works:

1. **CSS vars**: Open DevTools and set inline styles on the chart element, or modify CSS variables in the stylesheet. Colors should update instantly.

2. **Reactive cells**: Use the browser console to modify cell values and watch the layout update in real-time.

3. **Dark mode**: Toggle the system dark mode preference or use DevTools to simulate it. Colors should adapt.

## Performance Notes

- CSS variable reads are cached in reactive cells via an effect, avoiding repeated `getComputedStyle()` calls
- Geometry cell changes trigger efficient reactive re-layout
- No full re-renders — only affected SVG attributes update
