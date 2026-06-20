<svelte:options customElement="lc-sunburst-lc" />

<!--
  Sunburst = d3.partition laid out into polar coords. We size <Partition>
  directly into [angle ∈ [0, 2π], radius ∈ [0, R]] so each node's x0/x1 come
  back as start/end angles and y0/y1 as inner/outer radii — no <Bounds> needed.

  Same shared bireactive tree model as the treemap; same gesture model
  (hover + cmd/ctrl+wheel, sticky-locked on the modifier; Tab navigates;
  arrows nudge value). Group scaling rescales sibling arcs via Num.lens.

  Live-data seam: when sliceboard injects `externalRoot` (a writable BiNode tree
  built from the active dataset) the chart binds to it instead of the standalone
  module-scope sharedTree, and edits write back through it. `no-source` hides the
  footer hint; `brSync` bridges hover/select to the sliceboard hudStore.
-->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { type HierarchyRectangularNode } from "d3-hierarchy";
  import { Chart, Svg, Partition, Arc } from "layerchart";
  import { sharedTree, buildParentIndex, type BiNode } from "./tree";
  import {
    applyDelta,
    flatOrder,
    buildHierarchy,
    subscribeAllLeaves,
    installGestureRelease,
  } from "./interaction";
  import { makeBridge, type ElementWithBridge } from "./hud-bridge";
  import { observeHostSize } from "./host-size";

  let {
    width = 480,
    height = 480,
    externalRoot = undefined,
  }: { width?: number; height?: number; externalRoot?: BiNode } = $props();

  // Effective size: fixed props standalone; tracks the host (tile) when mounted
  // as a sliceboard custom element (see onMount → observeHostSize below).
  let w = $state(width);
  let h = $state(height);

  // Bind to the injected tree when present, else the standalone sharedTree.
  const root = externalRoot ?? sharedTree;
  const parentIdx = buildParentIndex(root);
  const parentOf = (n: BiNode) => parentIdx.get(n);

  let version = $state(0);
  onDestroy(subscribeAllLeaves(root, () => version++));

  const hData = $derived.by(() => {
    void version;
    return buildHierarchy(root);
  });

  let focusedNode = $state.raw<BiNode | null>(null);
  let hoveredNode = $state.raw<BiNode | null>(null);
  let wheelLocked = $state.raw<BiNode | null>(null);

  $effect(() => installGestureRelease(() => (wheelLocked = null)));

  // ── Cross-tile hover/select bridge ──────────────────────────────────────────
  // Index nodes by PNode id so external ids resolve to BiNodes.
  let hostEl = $state.raw<ElementWithBridge | null>(null);
  let applyingExternal = false;
  const byId = new Map<string, BiNode>();
  for (const n of flatOrder(root)) if (n.value.id) byId.set(n.value.id, n);
  if (root.value.id) byId.set(root.value.id, root);

  const bridge = makeBridge({
    setHover: (id) => {
      applyingExternal = true;
      hoveredNode = id ? byId.get(id) ?? null : null;
      applyingExternal = false;
    },
    setSelect: (id) => {
      applyingExternal = true;
      focusedNode = id ? byId.get(id) ?? null : null;
      applyingExternal = false;
    },
  });

  let disposeSize: (() => void) | undefined;
  onMount(() => {
    hostEl = ($host() as ElementWithBridge) ?? null;
    if (hostEl) {
      hostEl.brSync = bridge;
      // Fill the tile (sliceboard) — fall back to fixed props standalone.
      disposeSize = observeHostSize(hostEl, height / width, (nw, nh) => { w = nw; h = nh; });
    }
  });
  onDestroy(() => {
    if (hostEl) hostEl.brSync = undefined;
    disposeSize?.();
  });

  // Emit our own hover/select out, unless we're echoing an external write.
  $effect(() => {
    const hov = hoveredNode;
    if (applyingExternal) return;
    bridge.emitHover(hov?.value.id ?? null);
  });
  $effect(() => {
    const f = focusedNode;
    if (applyingExternal) return;
    bridge.emitSelect(f?.value.id ?? null);
  });

  const noSource = $derived(hostEl?.hasAttribute("no-source") ?? false);

  function onWheel(e: WheelEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (!wheelLocked) wheelLocked = hoveredNode ?? focusedNode;
    const target = wheelLocked;
    if (!target || target === root) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    applyDelta(target, e.deltaY < 0 ? +step : -step, parentOf);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Tab") {
      const order = flatOrder(root);
      if (order.length === 0) return;
      const i = focusedNode ? order.indexOf(focusedNode) : -1;
      focusedNode = e.shiftKey
        ? order[(i <= 0 ? order.length : i) - 1]
        : order[(i + 1) % order.length];
      e.preventDefault();
      return;
    }
    if (!focusedNode || focusedNode === root) return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      applyDelta(focusedNode, +step, parentOf);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      applyDelta(focusedNode, -step, parentOf);
      e.preventDefault();
    }
  }

  const total = $derived.by(() => {
    void version;
    return root.value.total.value;
  });

  const radius = $derived(Math.min(w, h) / 2 - 4);
</script>

<div
  style="width: {w}px; height: {h}px; outline: none;"
  tabindex="0"
  role="application"
  aria-label="sunburst-lc"
  onwheel={onWheel}
  onkeydown={onKeydown}
>
  <Chart data={hData} width={w} height={h}>
    <Svg center>
      <Partition size={[2 * Math.PI, radius]} let:nodes>
        {#each nodes as node (node.data)}
          {@const n = node as HierarchyRectangularNode<BiNode>}
          {@const isLeaf = n.data.children.length === 0}
          {@const isFocused = focusedNode === n.data}
          {@const isHovered = hoveredNode === n.data}
          {#if n.depth > 0}
            <Arc
              startAngle={n.x0}
              endAngle={n.x1}
              innerRadius={n.y0}
              outerRadius={n.y1}
              fill={n.data.value.color}
              fillOpacity={isLeaf ? 0.95 : 0.5}
              stroke={isFocused ? "#fff" : isHovered ? "#c8cdd6" : "#0b0d12"}
              strokeWidth={isFocused || isHovered ? 2 : 1}
              onclick={() => (focusedNode = n.data)}
              onpointerenter={() => (hoveredNode = n.data)}
              onpointerleave={() => { if (hoveredNode === n.data) hoveredNode = null; }}
            />
          {/if}
        {/each}
      </Partition>
    </Svg>
  </Chart>
  {#if !noSource}
    <div style="font-size: 10px; color: #9aa0a8; text-align: center; margin-top: -18px; pointer-events: none;">
      total: {total.toFixed(0)} · focused: {focusedNode?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab
    </div>
  {/if}
</div>

<style>
  /* Fill the tile WIDTH so observeHostSize measures it; height follows the
     chart's aspect (height:100% would feed svg growth back into the RO and
     loop). overflow hidden clips a square chart in a short/wide tile. */
  :host { display: block; width: 100%; overflow: hidden; }
</style>
