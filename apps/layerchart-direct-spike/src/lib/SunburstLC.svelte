<svelte:options customElement="lc-sunburst-lc" />

<!--
  Sunburst = d3.partition laid out into polar coords. We size <Partition>
  directly into [angle ∈ [0, 2π], radius ∈ [0, R]] so each node's x0/x1 come
  back as start/end angles and y0/y1 as inner/outer radii — no <Bounds> needed.

  Same shared bireactive tree as the treemap; same gesture model
  (hover + cmd/ctrl+wheel, sticky-locked on the modifier; Tab navigates;
  arrows nudge value). Group scaling rescales sibling arcs via Num.lens.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import { type HierarchyRectangularNode } from "d3-hierarchy";
  import { Chart, Svg, Partition, Arc } from "layerchart";
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
    return sharedTree.value.total.value;
  });

  const radius = Math.min(width, height) / 2 - 4;
</script>

<div
  style="width: {width}px; height: {height}px; outline: none;"
  tabindex="0"
  role="application"
  aria-label="sunburst-lc"
  onwheel={onWheel}
  onkeydown={onKeydown}
>
  <Chart data={hData} {width} {height}>
    <Svg center>
      <Partition size={[2 * Math.PI, radius]} let:nodes>
        {#each nodes as node (node.data)}
          {@const n = node as HierarchyRectangularNode<BiNode>}
          {@const isLeaf = n.data.children.length === 0}
          {@const isFocused = focusedNode === n.data}
          {#if n.depth > 0}
            <Arc
              startAngle={n.x0}
              endAngle={n.x1}
              innerRadius={n.y0}
              outerRadius={n.y1}
              fill={n.data.value.color}
              fillOpacity={isLeaf ? 0.95 : 0.5}
              stroke={isFocused ? "#fff" : "#0b0d12"}
              strokeWidth={isFocused ? 2 : 1}
              onclick={() => (focusedNode = n.data)}
              onpointerenter={() => (hoveredNode = n.data)}
              onpointerleave={() => { if (hoveredNode === n.data) hoveredNode = null; }}
            />
          {/if}
        {/each}
      </Partition>
    </Svg>
  </Chart>
  <div style="font-size: 10px; color: #9aa0a8; text-align: center; margin-top: -18px; pointer-events: none;">
    total: {total.toFixed(0)} · focused: {focusedNode?.value.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab
  </div>
</div>
