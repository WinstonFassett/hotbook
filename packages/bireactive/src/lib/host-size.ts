// Reactive host sizing for Diagram custom elements.
//
// The base `Diagram` hardcodes its viewBox via `view(W, H)` and sizes `:host`
// to `max-width: calc(--d-w * 1px)` with `svg { height: auto }`. That pins the
// element to its design size inside a flex/grid tile — the chart never fills
// its container. `useHostSize` replaces that with a `ResizeObserver`-driven
// pair of reactive cells: feed them into `view()` and into layout `derive()`s
// so the chart reflows to the tile's true dimensions.
//
// The observer tracks BOTH width and height independently so the chart fills
// height-constrained containers (hotbook tiles) without baking in an aspect
// ratio. `svg { height: 100% }` is safe here because `:host` is always
// height-constrained by the tile — the SVG cannot feed its own height back into
// the observer since the host size is set by the tile, not the SVG.

import { cell, type Cell } from "bireactive";

export interface HostSize {
  /** Reactive container width in px (floored). */
  w: Cell<number>;
  /** Reactive container height in px (floored). */
  h: Cell<number>;
}

// Per-instance RO registry so re-running `scene()` (every connectedCallback)
// disposes the prior observer instead of leaking one per reconnect.
const observers = new WeakMap<HTMLElement, ResizeObserver>();

// Override the base `Diagram` `:host`/`svg` rules so the chart fills its tile.
// Both width and height are 100% — safe because hotbook tiles are always
// height-constrained (fixed-size flex/grid cells).
export const FILL_STYLE = `
  :host { display:block; width:100%; height:100%; max-width:none; margin:0; }
  svg { display:block; width:100%; height:100%; }
`;

export function useHostSize(
  host: HTMLElement,
  fallback: { width: number; height: number },
): HostSize {
  const w = cell(fallback.width);
  const h = cell(fallback.height);

  observers.get(host)?.disconnect();

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      const nw = Math.max(1, Math.floor(e.contentRect.width));
      const nh = Math.max(1, Math.floor(e.contentRect.height));
      if (nw !== w.value) w.value = nw;
      if (nh !== h.value) h.value = nh;
    });
    ro.observe(host);
    observers.set(host, ro);

    // Seed immediately from current layout so the first frame isn't fallback.
    const r = host.getBoundingClientRect();
    if (r.width > 0) w.value = Math.max(1, Math.floor(r.width));
    if (r.height > 0) h.value = Math.max(1, Math.floor(r.height));
  }

  return { w, h };
}
