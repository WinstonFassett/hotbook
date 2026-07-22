// Theming cells for hierarchical charts (icicle, pack, sunburst, treemap, treetable).
// Reactive cells for geometry values + CSS custom property sync for colors.
//
// Design: follows motion.separation pattern (runtime-config.ts). Geometry
// cells drive layout math (padding, font sizes, stroke widths). Color cells
// read from CSS vars via getComputedStyle and provide fallbacks.
//
// Charts read from these cells at render time → tweaking a cell or overriding
// a CSS var updates all hierarchical charts that use HierarchicalChartBase.

import { cell, effect, type Cell, type Writable } from "bireactive";

export interface HierarchicalThemeCells {
  /** Tile padding for treemap group headers (paddingTop). */
  tilePadding: Writable<Cell<number>>;
  /** Label font size (px). */
  fontSize: Writable<Cell<number>>;
  /** Base stroke width multiplier (multiplied by motion.separation). */
  strokeWidthBase: Writable<Cell<number>>;
  /** Arc padding for radial layouts (sunburst). */
  arcPadding: Writable<Cell<number>>;
  /** Focus outline color (CSS var: --color-focus). */
  focusColor: Writable<Cell<string>>;
  /** Hover outline color (CSS var: --color-hover). */
  hoverColor: Writable<Cell<string>>;
  /** Tile stroke color (CSS var: --color-tile-stroke). */
  tileStroke: Writable<Cell<string>>;
  /** Tile stroke color for depth 0 (root) (CSS var: --color-tile-stroke-root). */
  tileStrokeRoot: Writable<Cell<string>>;
}

export const HIERARCHICAL_THEME_DEFAULTS = {
  tilePadding: 16,
  fontSize: 11,
  strokeWidthBase: 1,
  arcPadding: 1,
  focusColor: "#fff",
  hoverColor: "#c8cdd6",
  tileStroke: "#0b0d12",
  tileStrokeRoot: "#444",
} as const;

export const hierarchicalTheme: HierarchicalThemeCells = {
  tilePadding: cell<number>(HIERARCHICAL_THEME_DEFAULTS.tilePadding),
  fontSize: cell<number>(HIERARCHICAL_THEME_DEFAULTS.fontSize),
  strokeWidthBase: cell<number>(HIERARCHICAL_THEME_DEFAULTS.strokeWidthBase),
  arcPadding: cell<number>(HIERARCHICAL_THEME_DEFAULTS.arcPadding),
  focusColor: cell<string>(HIERARCHICAL_THEME_DEFAULTS.focusColor),
  hoverColor: cell<string>(HIERARCHICAL_THEME_DEFAULTS.hoverColor),
  tileStroke: cell<string>(HIERARCHICAL_THEME_DEFAULTS.tileStroke),
  tileStrokeRoot: cell<string>(HIERARCHICAL_THEME_DEFAULTS.tileStrokeRoot),
};

export function resetHierarchicalThemeToDefaults(): void {
  hierarchicalTheme.tilePadding.value = HIERARCHICAL_THEME_DEFAULTS.tilePadding;
  hierarchicalTheme.fontSize.value = HIERARCHICAL_THEME_DEFAULTS.fontSize;
  hierarchicalTheme.strokeWidthBase.value = HIERARCHICAL_THEME_DEFAULTS.strokeWidthBase;
  hierarchicalTheme.arcPadding.value = HIERARCHICAL_THEME_DEFAULTS.arcPadding;
  hierarchicalTheme.focusColor.value = HIERARCHICAL_THEME_DEFAULTS.focusColor;
  hierarchicalTheme.hoverColor.value = HIERARCHICAL_THEME_DEFAULTS.hoverColor;
  hierarchicalTheme.tileStroke.value = HIERARCHICAL_THEME_DEFAULTS.tileStroke;
  hierarchicalTheme.tileStrokeRoot.value = HIERARCHICAL_THEME_DEFAULTS.tileStrokeRoot;
}

/** Sync CSS custom properties to theme cells. Call once per chart instance
 *  from connectedCallback to enable CSS var theming. Reads computed style
 *  from the element and updates color cells when CSS vars change. */
export function syncCssVarsToTheme(element: HTMLElement, disposers: (() => void)[]): void {
  if (typeof window === "undefined" || typeof getComputedStyle === "undefined") return;

  const syncColor = (varName: string, cell: Writable<Cell<string>>, fallback: string) => {
    const dispose = effect(() => {
      const style = getComputedStyle(element);
      const value = style.getPropertyValue(varName).trim();
      if (value && value !== cell.value) {
        cell.value = value;
      } else if (!value && cell.value !== fallback) {
        cell.value = fallback;
      }
    });
    disposers.push(dispose);
  };

  syncColor("--color-focus", hierarchicalTheme.focusColor, HIERARCHICAL_THEME_DEFAULTS.focusColor);
  syncColor("--color-hover", hierarchicalTheme.hoverColor, HIERARCHICAL_THEME_DEFAULTS.hoverColor);
  syncColor("--color-tile-stroke", hierarchicalTheme.tileStroke, HIERARCHICAL_THEME_DEFAULTS.tileStroke);
  syncColor("--color-tile-stroke-root", hierarchicalTheme.tileStrokeRoot, HIERARCHICAL_THEME_DEFAULTS.tileStrokeRoot);
}
