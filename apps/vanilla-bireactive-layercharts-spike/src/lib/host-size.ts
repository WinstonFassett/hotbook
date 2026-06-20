// Reactive host sizing for Diagram custom elements.
//
// The base `Diagram` hardcodes its viewBox via `view(W, H)` and sizes `:host`
// to `max-width: calc(--d-w * 1px)` with `svg { height: auto }`. That pins the
// element to its design size inside a flex/grid tile — the chart never fills
// its container. `useHostSize` replaces that with a `ResizeObserver`-driven
// pair of reactive cells: feed them into `view()` and into layout `derive()`s
// so the chart reflows to the tile's true dimensions, matching the first-gen
// d3 elements (VizFormElement).
//
// Pass `fallback` dimensions for the pre-measure frame (and SSR/tests where
// ResizeObserver is absent). Add `FILL_STYLE` to the element's `static styles`
// so the host fills its tile and the svg fills the host; call `useHostSize`
// once at the top of `scene()`.

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

// Override the base `Diagram` `:host`/`svg` rules so the chart fills its tile
// instead of pinning to `max-width: calc(--d-w * 1px)` / `height: auto`. Add to
// each demo's `static styles` (it's a string template; concatenate).
//
// svg height is intentionally `auto` — the viewBox aspect ratio handles it.
// Setting height:100% would feed the svg's own height back into the RO,
// creating an infinite resize loop in non-height-constrained containers.
export const FILL_STYLE = `
  :host { display:block; width:100%; max-width:none; margin:0; }
  svg { display:block; width:100%; height:auto; }
`;

export function useHostSize(
  host: HTMLElement,
  fallback: { width: number; height: number },
): HostSize {
  const aspect = fallback.height / fallback.width;
  const w = cell(fallback.width);
  const h = cell(fallback.height);

  observers.get(host)?.disconnect();

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      const nw = Math.max(1, Math.floor(e.contentRect.width));
      if (nw === w.value) return;
      w.value = nw;
      h.value = Math.max(1, Math.round(nw * aspect));
    });
    ro.observe(host);
    observers.set(host, ro);

    // Seed immediately from current layout so the first frame isn't fallback.
    const r = host.getBoundingClientRect();
    if (r.width > 0) {
      const nw = Math.max(1, Math.floor(r.width));
      w.value = nw;
      h.value = Math.max(1, Math.round(nw * aspect));
    }
  }

  return { w, h };
}
