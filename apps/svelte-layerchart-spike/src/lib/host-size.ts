// Reactive host sizing for the Svelte LayerChart custom elements.
//
// Each *LC.svelte takes fixed width/height props (480/720 defaults). Inside a
// sliceboard tile that pins the chart to its design size instead of filling the
// container. This mirrors the vanilla spike's `useHostSize`
// (apps/vanilla-bireactive-layercharts-spike/src/lib/host-size.ts): observe the
// host element and report a width/height pair (aspect preserved) that the
// component feeds into its <Chart> so it reflows to the tile's true size.
//
// Observes WIDTH ONLY and derives height from `aspect` (height/width). This is
// deliberate — matching the vanilla spike's `useHostSize`: observing height too
// while the chart's svg height tracks its content creates a feedback loop
// ("ResizeObserver loop completed with undelivered notifications"). Width is the
// stable driver; the chart keeps its design aspect ratio inside the tile.
//
// Returns a disposer; call from onMount and pass a setter that writes the
// component's width/height $state. Seeds immediately from the current rect so
// the first frame isn't the fallback size.

export function observeHostSize(
  host: HTMLElement,
  aspect: number, // height / width
  set: (w: number, h: number) => void,
): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};

  let lastW = 0;
  const apply = (rawW: number) => {
    const w = Math.max(1, Math.floor(rawW));
    if (w === lastW) return; // ignore height-only / no-op notifications
    lastW = w;
    set(w, Math.max(1, Math.round(w * aspect)));
  };

  const ro = new ResizeObserver(([e]) => { if (e) apply(e.contentRect.width); });
  ro.observe(host);

  const r = host.getBoundingClientRect();
  if (r.width > 0) apply(r.width);

  return () => ro.disconnect();
}
