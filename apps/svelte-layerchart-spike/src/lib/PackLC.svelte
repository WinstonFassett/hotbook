<svelte:options customElement="lc-pack-lc" />

<!--
  Circle packing via d3.pack, layered as nested circles. Pack yields
  HierarchyCircularNode (x, y, r) per node — note x/y are circle centers,
  not the [0,0]-anchored rect coords the other layouts use.

  Same shared bireactive tree; same gesture model.
-->

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { type HierarchyCircularNode } from "d3-hierarchy";
  import { Chart, Svg, Pack, Circle } from "layerchart";
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

  // Effective size: fixed props standalone; tracks the tile when mounted as a
  // sliceboard custom element (see onMount → observeHostSize).
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
      disposeSize = observeHostSize(hostEl, height / width, (nw, nh) => { w = nw; h = nh; });
    }
  });
  onDestroy(() => {
    if (hostEl) hostEl.brSync = undefined;
    disposeSize?.();
  });

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
</script>

<div
  style="width: {w}px; height: {h}px; outline: none;"
  tabindex="0"
  role="application"
  aria-label="pack-lc"
  onwheel={onWheel}
  onkeydown={onKeydown}
>
  <Chart data={hData} width={w} height={h}>
    <Svg>
      <Pack padding={2} let:nodes>
        {#each nodes as node (node.data)}
          {@const n = node as HierarchyCircularNode<BiNode>}
          {@const isLeaf = n.data.children.length === 0}
          {@const isFocused = focusedNode === n.data}
          {@const isHovered = hoveredNode === n.data}
          <Circle
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={n.data.value.color}
            fillOpacity={n.depth === 0 ? 0.12 : isLeaf ? 0.95 : 0.4}
            stroke={isFocused ? "#fff" : isHovered ? "#c8cdd6" : n.depth === 0 ? "#444" : "#0b0d12"}
            strokeWidth={isFocused || isHovered ? 2 : 1}
            onclick={() => (focusedNode = n.data)}
            onpointerenter={() => (hoveredNode = n.data)}
            onpointerleave={() => { if (hoveredNode === n.data) hoveredNode = null; }}
          />
          {#if isLeaf && n.r > 14}
            <text
              x={n.x}
              y={n.y}
              text-anchor="middle"
              dominant-baseline="middle"
              font-size="11"
              fill="#fff"
              pointer-events="none"
            >
              {n.data.value.label}<tspan x={n.x} dy="1.2em" font-size="9">{n.data.value.total.value.toFixed(0)}</tspan>
            </text>
          {/if}
        {/each}
      </Pack>
    </Svg>
  </Chart>
  {#if !noSource}
    <div style="font-size: 10px; color: #9aa0a8; text-align: center; margin-top: -18px; pointer-events: none;">
      total: {total.toFixed(0)} · focused: {focusedNode?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab
    </div>
  {/if}
</div>

<style>
  /* Fill the tile WIDTH; height follows aspect (see SunburstLC for why not 100%). */
  :host { display: block; width: 100%; overflow: hidden; }
</style>
