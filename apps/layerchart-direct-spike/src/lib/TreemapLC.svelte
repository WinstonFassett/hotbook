<svelte:options customElement="lc-treemap-lc" />

<!--
  Real LayerChart <Chart> + <Treemap> driven by the shared bireactive tree.

  Path A validation: does LayerChart's hierarchy vocabulary survive being backed
  by writable cells? We build a d3 hierarchy snapshot inside $derived.by, which
  re-runs whenever any leaf cell changes (via biEffect bumping `version`). The
  snapshot is passed to <Chart data=...>; LayerChart re-runs its own layout.

  Same interaction model as Treemap.svelte:
    - Hover + cmd/ctrl+wheel scrubs the hovered (or focus-fallback) node.
    - Sticky lock during the modifier-held gesture: relayout / zero-shrink
      can't break the interaction; release cmd/ctrl to end.
    - Click to focus; Tab / Shift+Tab walks cells; arrows nudge (±1, shift ±5).
    - Groups scale via Num.lens — proportional child redistribution + sibling
      compensation at the same level.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import { hierarchy, type HierarchyRectangularNode } from "d3-hierarchy";
  import { Chart, Svg, Treemap, Group, Rect } from "layerchart";
  import { effect as biEffect } from "bireactive";
  import { sharedTree, leaves, parentOf, type BiNode } from "./tree";

  let { width = 720, height = 360 }: { width?: number; height?: number } = $props();

  let version = $state(0);
  const allLeaves = leaves(sharedTree);
  const disposeBiEffect = biEffect(() => {
    for (const l of allLeaves) void l.total.value;
    version++;
  });
  onDestroy(disposeBiEffect);

  // Snapshot the bireactive tree as a d3 hierarchy. Re-runs on any cell change.
  // LayerChart's <Chart data={...}> consumes this directly.
  const hData = $derived.by(() => {
    void version;
    return hierarchy<BiNode>(sharedTree, (n) => n.children)
      .sum((n) => (n.children ? 0 : n.total.value));
  });

  let focusedNode = $state.raw<BiNode | null>(null);
  let hoveredNode = $state.raw<BiNode | null>(null);
  let wheelLocked = $state.raw<BiNode | null>(null);

  // Catch cmd/ctrl release at the window level. The wrapper element doesn't
  // reliably have focus after a wheel gesture (wheels don't transfer focus,
  // and inside a customElement shadow root focus often stays on document.body),
  // so an element-level onkeyup misses the release and the lock never clears.
  function onWindowKeyup(e: KeyboardEvent) {
    if (e.key === "Meta" || e.key === "Control" || (!e.metaKey && !e.ctrlKey)) {
      wheelLocked = null;
    }
  }
  // Also clear if the window loses focus mid-gesture (cmd+tab away, etc.) —
  // the keyup may never arrive in that case.
  function onWindowBlur() {
    wheelLocked = null;
  }
  $effect(() => {
    window.addEventListener("keyup", onWindowKeyup);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keyup", onWindowKeyup);
      window.removeEventListener("blur", onWindowBlur);
    };
  });

  function applyDelta(node: BiNode, delta: number) {
    const parent = parentOf(sharedTree, node);
    if (!parent || !parent.children) return;
    const siblings = parent.children.filter((c) => c !== node);
    const cur = node.total.value;
    const next = Math.max(0, cur + delta);
    const real = next - cur;
    if (real === 0) return;
    node.total.value = next;
    let remaining = real;
    if (real > 0) {
      const pool = siblings.filter((s) => s.total.value > 0);
      const poolSum = pool.reduce((a, b) => a + b.total.value, 0);
      if (poolSum > 0) {
        for (const sib of pool) {
          const share = (sib.total.value / poolSum) * real;
          const take = Math.min(sib.total.value, share);
          sib.total.value -= take;
          remaining -= take;
        }
        for (const sib of siblings) {
          if (remaining <= 0) break;
          const take = Math.min(sib.total.value, remaining);
          sib.total.value -= take;
          remaining -= take;
        }
      }
    } else if (siblings.length > 0) {
      const sibSum = siblings.reduce((a, b) => a + b.total.value, 0);
      if (sibSum > 0) {
        for (const sib of siblings) {
          const share = (sib.total.value / sibSum) * -real;
          sib.total.value += share;
        }
      } else {
        for (const sib of siblings) sib.total.value += -real / siblings.length;
      }
    }
  }

  function onWheel(e: WheelEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (!wheelLocked) wheelLocked = hoveredNode ?? focusedNode;
    const target = wheelLocked;
    if (!target || target === sharedTree) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    applyDelta(target, e.deltaY < 0 ? +step : -step);
  }

  function flatOrder(root: BiNode): BiNode[] {
    const out: BiNode[] = [];
    const walk = (n: BiNode) => {
      if (n !== root) out.push(n);
      n.children?.forEach(walk);
    };
    walk(root);
    return out;
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
  aria-label="treemap-lc"
  onwheel={onWheel}
  onkeydown={onKeydown}
>
  <Chart data={hData} {width} {height}>
    <Svg>
      <Treemap let:nodes paddingOuter={4} paddingInner={2} paddingTop={16}>
        {#each nodes as node (node.data)}
          {@const n = node as HierarchyRectangularNode<BiNode>}
          {@const w = Math.max(0, n.x1 - n.x0)}
          {@const h = Math.max(0, n.y1 - n.y0)}
          {@const isLeaf = !n.data.children}
          {@const isFocused = focusedNode === n.data}
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
              fillOpacity={n.depth === 0 ? 0.12 : isLeaf ? 0.95 : 0.45}
              stroke={isFocused ? "#fff" : n.depth === 0 ? "#444" : "#0b0d12"}
              stroke-width={isFocused ? 2 : 1}
              rx={3}
              style="cursor: pointer;"
            />
            {#if n.depth > 0 && w > 28 && h > 16}
              <text
                x={w / 2}
                y={isLeaf ? h / 2 : 10}
                text-anchor="middle"
                dominant-baseline="middle"
                font-size={isLeaf ? 11 : 10}
                font-weight={isLeaf ? 400 : 600}
                fill="#fff"
                pointer-events="none"
              >
                {n.data.label}{#if isLeaf}<tspan x={w / 2} dy="1.2em" font-size="10">{n.data.total.value.toFixed(0)}</tspan>{/if}
              </text>
            {/if}
          </Group>
        {/each}
      </Treemap>
    </Svg>
  </Chart>
  <div style="font-size: 10px; color: #9aa0a8; text-align: center; margin-top: -18px; pointer-events: none;">
    total: {total.toFixed(0)} · focused: {focusedNode?.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab
  </div>
</div>
