<svelte:options customElement="lc-icicle-lc" />

<!--
  Icicle = d3.partition in cartesian coords. Same Partition layout that drives
  the sunburst, but rendered as stacked bars. orientation="vertical" sizes the
  partition [width, height] so siblings span horizontally and depth flows
  downward — the conventional icicle look. (orientation="horizontal" swaps to
  [height, width], which puts depth on the x-axis and would need x/y swapped
  when reading x0/y0 from each node.)

  Same shared bireactive tree; same gesture model.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import { type HierarchyRectangularNode } from "d3-hierarchy";
  import { Chart, Svg, Partition, Group, Rect } from "layerchart";
  import { sharedTree, type BiNode } from "./tree";
  import {
    applyDelta,
    flatOrder,
    buildHierarchy,
    subscribeAllLeaves,
    installGestureRelease,
  } from "./interaction";

  let { width = 720, height = 360 }: { width?: number; height?: number } = $props();

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
  aria-label="icicle-lc"
  onwheel={onWheel}
  onkeydown={onKeydown}
>
  <Chart data={hData} {width} {height}>
    <Svg>
      <Partition orientation="vertical" let:nodes>
        {#each nodes as node (node.data)}
          {@const n = node as HierarchyRectangularNode<BiNode>}
          {@const w = Math.max(0, n.x1 - n.x0)}
          {@const h = Math.max(0, n.y1 - n.y0)}
          {@const isLeaf = !n.data.children}
          {@const isFocused = focusedNode === n.data}
          {#if n.depth > 0}
            <Group
              x={n.x0}
              y={n.y0}
              onclick={() => (focusedNode = n.data)}
              onpointerenter={() => (hoveredNode = n.data)}
              onpointerleave={() => { if (hoveredNode === n.data) hoveredNode = null; }}
            >
              <Rect
                width={w}
                height={h}
                fill={n.data.color}
                fillOpacity={isLeaf ? 0.95 : 0.5}
                stroke={isFocused ? "#fff" : "#0b0d12"}
                stroke-width={isFocused ? 2 : 1}
                rx={2}
                style="cursor: pointer;"
              />
              {#if w > 28 && h > 12}
                <text
                  x={w / 2}
                  y={h / 2}
                  text-anchor="middle"
                  dominant-baseline="middle"
                  font-size={isLeaf ? 11 : 10}
                  font-weight={isLeaf ? 400 : 600}
                  fill="#fff"
                  pointer-events="none"
                >
                  {n.data.label}{#if isLeaf}<tspan x={w / 2} dy="1.2em" font-size="9">{n.data.total.value.toFixed(0)}</tspan>{/if}
                </text>
              {/if}
            </Group>
          {/if}
        {/each}
      </Partition>
    </Svg>
  </Chart>
  <div style="font-size: 10px; color: #9aa0a8; text-align: center; margin-top: -18px; pointer-events: none;">
    total: {total.toFixed(0)} · focused: {focusedNode?.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab
  </div>
</div>
