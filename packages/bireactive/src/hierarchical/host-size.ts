// host-size.ts — reactive host sizing for the icicle harness.
// ResizeObserver-driven cells for width and height. No fixed viewBox.

import { cell, type Cell } from "bireactive";

export interface HostSize {
  w: Cell<number>;
  h: Cell<number>;
}

export function useHostSize(
  target: HTMLElement,
  fallback: { width: number; height: number },
  observe?: Element,
): HostSize {
  const w = cell(fallback.width);
  const h = cell(fallback.height);
  const el = observe ?? target;

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      const nw = Math.max(1, Math.floor(e.contentRect.width));
      const nh = Math.max(1, Math.floor(e.contentRect.height));
      if (nw !== w.value) w.value = nw;
      if (nh !== h.value) h.value = nh;
    });
    ro.observe(el);

    const r = el.getBoundingClientRect();
    if (r.width > 0) w.value = Math.max(1, Math.floor(r.width));
    if (r.height > 0) h.value = Math.max(1, Math.floor(r.height));

    // Return disposer alongside cells via a side channel — the caller
    // can't get it back, so we stash it on the target for cleanup.
    (target as any)._roDispose = () => ro.disconnect();
  }

  return { w, h };
}
