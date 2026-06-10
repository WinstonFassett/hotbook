<svelte:options customElement="lc-pack-lc" />

<!--
  Circle packing via d3.pack, layered as nested circles. Pack yields
  HierarchyCircularNode (x, y, r) per node — note x/y are circle centers,
  not the [0,0]-anchored rect coords the other layouts use.

  Same shared bireactive tree; same gesture model.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import { type HierarchyCircularNode } from "d3-hierarchy";
  import { Chart, Svg, Pack, Circle } from "layerchart";
  import { sharedTree, type BiNode } from "./tree";
  import {
    applyDelta,
    flatOrder,
    buildHierarchy,
    subscribeAllLeaves,
    installGestureRelease,
  } from "./interaction";

  let { width = 480, height = 480 }: { width?: number; height?: number } = $props();

  let version = $state(0);
  onDestroy(subscribeAllLeaves(() => version++));

  const hData = $derived.by(() => {
    void version;
    return buildHierarchy();
  });

  let focusedNode = $state.raw<BiNode | null>(null);
  let hoveredNode = $state.raw<BiNode | null>(null);
  let wheelLocked = $state.raw<BiNode | null>(null);

  $effect(() => installGestureRelease(() => (wheelLocked = null)));

  function onWheel(e: WheelEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (!wheelLocked) wheelLocked = hoveredNode ?? focusedNode;
    const target = wheelLocked;
    if (!target || target === sharedTree) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    applyDelta(target, e.deltaY < 0 ? +step : -step);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Tab") {
      const order = flatOrder(sharedTree);
      if (order.length === 0) return;
      const i = focusedNode ? order.indexOf(focusedNode) : -1;
      focusedNode = e.shiftKey
        ? order[(i <= 0 ? order.length : i) - 1]
        : order[(i + 1) % order.length];
      e.preventDefault();
      return;
    }
    if (!focusedNode || focusedNode === sharedTree) return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      applyDelta(focusedNode, +step);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      applyDelta(focusedNode, -step);
      e.preventDefault();
    }
  }

  const total = $derived.by(() => {
    void version;
    return sharedTree.total.value;
  });
</script>

<div
  style="width: {width}px; height: {height}px; outline: none;"
  tabindex="0"
  role="application"
  aria-label="pack-lc"
  onwheel={onWheel}
  onkeydown={onKeydown}
>
  <Chart data={hData} {width} {height}>
    <Svg>
      <Pack padding={2} let:nodes>
        {#each nodes as node (node.data)}
          {@const n = node as HierarchyCircularNode<BiNode>}
          {@const isLeaf = !n.data.children}
          {@const isFocused = focusedNode === n.data}
          <Circle
            cx={n.x}
            cy={n.y}
            r={n.r}
            fill={n.data.color}
            fillOpacity={n.depth === 0 ? 0.12 : isLeaf ? 0.95 : 0.4}
            stroke={isFocused ? "#fff" : n.depth === 0 ? "#444" : "#0b0d12"}
            strokeWidth={isFocused ? 2 : 1}
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
              {n.data.label}<tspan x={n.x} dy="1.2em" font-size="9">{n.data.total.value.toFixed(0)}</tspan>
            </text>
          {/if}
        {/each}
      </Pack>
    </Svg>
  </Chart>
  <div style="font-size: 10px; color: #9aa0a8; text-align: center; margin-top: -18px; pointer-events: none;">
    total: {total.toFixed(0)} · focused: {focusedNode?.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab
  </div>
</div>
