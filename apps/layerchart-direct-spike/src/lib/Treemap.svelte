<svelte:options customElement="lc-treemap-demo" />

<!--
  Treemap demo — proves three things:
    1. Svelte 5 can host bireactive cells (via the bridge / via direct read in $derived).
    2. Editing a leaf via cmd/ctrl+wheel triggers the Num.lens, which redistributes
       siblings AND re-derives parent totals — without any cross-tile event wiring.
    3. Compiles to a custom element <lc-treemap-demo> for embedding from any host
       (React, plain HTML, sliceboard).

  This is the "minimal mock chart context" path (β in the design discussion):
  we do NOT vendor LayerChart's <Chart>/<ChartContext> here — just call d3.treemap
  directly. The next step (after the bridge is proven) is to vendor the real
  LayerChart layout components and feed them the shared tree.

  Interaction:
    - Hover a tile + cmd/ctrl+wheel to scrub. While the modifier is held the
      gesture target is locked, so re-layout (or a tile shrinking to zero) can't
      steal the gesture out from under the cursor — release cmd/ctrl to end.
    - Click to focus a tile for keyboard control. Tab / Shift+Tab walk siblings
      and descend into the focused branch's first child. Arrow keys nudge
      value (±1, shift ±5). Groups scale via their Num.lens.
-->

<script lang="ts">
  import { onDestroy } from "svelte";
  import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
  // Match LayerChart's tile wrapping so subtree orientation decisions agree
  // with Instance C. Squarify operates against the outer chart aspect ratio,
  // then children are rescaled into their actual sub-rect. This is what
  // enables smooth zoom transitions in LayerChart's treemap.
  function aspectTile(tile: typeof treemapSquarify, w: number, h: number) {
    return (node: any, x0: number, y0: number, x1: number, y1: number) => {
      tile(node, 0, 0, w, h);
      for (const child of node.children ?? []) {
        child.x0 = x0 + (child.x0 / w) * (x1 - x0);
        child.x1 = x0 + (child.x1 / w) * (x1 - x0);
        child.y0 = y0 + (child.y0 / h) * (y1 - y0);
        child.y1 = y0 + (child.y1 / h) * (y1 - y0);
      }
    };
  }
  import { effect as biEffect } from "bireactive";
  import { sharedTree, leaves, parentOf, type BiNode } from "./tree";

  let { width = 720, height = 360 }: { width?: number; height?: number } = $props();

  // Bridge bireactive → Svelte 5 reactivity. The pattern: a $state version
  // number that we bump whenever any cell read inside our effect changes.
  // Then $derived expressions that read `version` + cell values re-run.
  // This is the simplest possible bridge — no per-cell stores, just one
  // global "something in the tree changed" signal.
  let version = $state(0);

  // Tell bireactive to call our effect whenever any cell read inside it
  // changes. Reading every leaf's .value subscribes us to all of them; lens
  // branches re-derive automatically so we don't need to read them too.
  // NOTE: do NOT wrap biEffect inside Svelte's $effect — Svelte would track
  // the `version++` write as a dep of the outer effect, creating a cycle.
  // Set up the bireactive subscription at component init time and tear down
  // via onDestroy.
  let allLeaves = leaves(sharedTree);
  const disposeBiEffect = biEffect(() => {
    for (const l of allLeaves) void l.total.value;
    version++;
  });
  onDestroy(disposeBiEffect);

  // Compute layout. Reads `version` so it re-runs on any tree change.
  type Tile = { node: BiNode; x0: number; y0: number; x1: number; y1: number; depth: number; isLeaf: boolean };

  const tiles = $derived.by(() => {
    void version; // depend on version
    const h = hierarchy<BiNode>(sharedTree, (n) => n.children)
      .sum((n) => (n.children ? 0 : n.total.value));
    const laid = treemap<BiNode>()
      .tile(aspectTile(treemapSquarify, width, height))
      .size([width, height])
      .paddingOuter(4)
      .paddingInner(2)
      .paddingTop(16)
      .round(false)(h);
    const out: Tile[] = [];
    laid.each((d) => {
      out.push({
        node: d.data,
        x0: d.x0,
        y0: d.y0,
        x1: d.x1,
        y1: d.y1,
        depth: d.depth,
        isLeaf: !d.data.children,
      });
    });
    return out;
  });

  // Use raw — BiNode contains bireactive Cell objects which Svelte's proxy
  // mishandles. Raw means equality is identity, which is what we want for
  // node references.
  let focusedNode = $state.raw<BiNode | null>(null);
  let hoveredNode = $state.raw<BiNode | null>(null);

  // Sticky gesture lock. Set on first cmd/ctrl+wheel event, cleared when the
  // modifier key is released. This is the fix for "tile relayouts out from
  // under the cursor mid-gesture" and "tile shrinks to zero and is unreachable":
  // once a gesture starts, the target node is pinned independent of cursor
  // position or layout.
  let wheelLocked = $state.raw<BiNode | null>(null);

  function applyDelta(node: BiNode, delta: number) {
    const parent = parentOf(sharedTree, node);
    if (!parent || !parent.children) return;
    const siblings = parent.children.filter((c) => c !== node);
    const cur = node.total.value;
    const next = Math.max(0, cur + delta);
    const real = next - cur;
    if (real === 0) return;
    // Writing to a branch's total goes through Num.lens, which redistributes
    // the branch's children proportionally — so groups scale naturally.
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

  function onTileClick(t: Tile) {
    focusedNode = t.node;
  }

  function onTileEnter(t: Tile) {
    hoveredNode = t.node;
  }

  function onTileLeave(t: Tile) {
    if (hoveredNode === t.node) hoveredNode = null;
  }

  function onWheel(e: WheelEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;
    // Pick the target: locked node wins; otherwise hovered; otherwise focused.
    // Don't scale the root (no parent to redistribute against).
    if (!wheelLocked) wheelLocked = hoveredNode ?? focusedNode;
    const target = wheelLocked;
    if (!target || target === sharedTree) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    applyDelta(target, e.deltaY < 0 ? +step : -step);
  }

  // Release the lock the moment the modifier comes back up — that's the
  // natural gesture boundary. Listen at window level because the svg doesn't
  // reliably have focus after a wheel gesture (wheels don't transfer focus,
  // and inside a customElement shadow root focus often stays on document.body),
  // so element-level keyup misses the release and the lock never clears.
  function onWindowKeyup(e: KeyboardEvent) {
    if (e.key === "Meta" || e.key === "Control" || (!e.metaKey && !e.ctrlKey)) {
      wheelLocked = null;
    }
  }
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

  // Tab navigation: walk a depth-first ordering of the whole tree (skip root).
  // Arrow keys still nudge the focused node's value; Tab moves focus.
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
      const next = e.shiftKey
        ? order[(i <= 0 ? order.length : i) - 1]
        : order[(i + 1) % order.length];
      focusedNode = next;
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

  // Show the total via a $derived too — proves the branch lens aggregates live.
  const total = $derived.by(() => {
    void version;
    return sharedTree.total.value;
  });
</script>

<svg
  {width}
  {height}
  tabindex="0"
  role="application"
  aria-label="treemap"
  onwheel={onWheel}
  onkeydown={onKeydown}
  style="outline: none; font-family: ui-sans-serif, system-ui, sans-serif;"
>
  {#each tiles as t (t.node)}
    {@const w = Math.max(0, t.x1 - t.x0)}
    {@const h = Math.max(0, t.y1 - t.y0)}
    {@const isFocused = focusedNode === t.node}
    <rect
      x={t.x0}
      y={t.y0}
      width={w}
      height={h}
      fill={t.node.color}
      opacity={t.depth === 0 ? 0.12 : t.isLeaf ? 0.95 : 0.45}
      stroke={isFocused ? "#fff" : t.depth === 0 ? "#444" : "#0b0d12"}
      stroke-width={isFocused ? 2 : 1}
      rx={3}
      style="cursor: pointer;"
      onclick={() => onTileClick(t)}
      onmouseenter={() => onTileEnter(t)}
      onmouseleave={() => onTileLeave(t)}
    />
    {#if t.depth > 0 && w > 28 && h > 16}
      <text
        x={t.x0 + w / 2}
        y={t.y0 + (t.isLeaf ? h / 2 : 10)}
        text-anchor="middle"
        dominant-baseline="middle"
        font-size={t.isLeaf ? 11 : 10}
        font-weight={t.isLeaf ? 400 : 600}
        fill="#fff"
        pointer-events="none"
      >
        {t.node.label}{#if t.isLeaf}
          <tspan x={t.x0 + w / 2} dy="1.2em" font-size="10">{t.node.total.value.toFixed(0)}</tspan>
        {/if}
      </text>
    {/if}
  {/each}
  <text x={width / 2} y={height - 6} text-anchor="middle" font-size="10" fill="#9aa0a8">
    total: {total.toFixed(0)} · focused: {focusedNode?.label ?? "(none)"} · hover + cmd/ctrl+wheel · click + arrows/Tab
  </text>
</svg>
