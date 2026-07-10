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
  import { onDestroy, onMount } from "svelte";
  import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
  import { observeHostSize } from "./host-size";
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
  import { initialGestureState, type GestureSignalState, type ReparentProposal } from "./gestureSignal";

  let { width = 720, height = 360 }: { width?: number; height?: number } = $props();

  // Effective canvas size: fixed props standalone; tracks the tile when mounted
  // as a sliceboard custom element (observeHostSize in onMount below).
  let cw = $state(width);
  let ch = $state(height);
  let disposeSize: (() => void) | undefined;
  onMount(() => {
    const host = $host() as HTMLElement | undefined;
    if (host) disposeSize = observeHostSize(host, height / width, (nw, nh) => { cw = nw; ch = nh; });
  });
  onDestroy(() => disposeSize?.());

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
    for (const l of allLeaves) void l.value.total.value;
    version++;
  });
  onDestroy(disposeBiEffect);

  // Compute layout. Reads `version` so it re-runs on any tree change.
  type Tile = { node: BiNode; x0: number; y0: number; x1: number; y1: number; depth: number; isLeaf: boolean };

  const tiles = $derived.by(() => {
    void version; // depend on version
    const h = hierarchy<BiNode>(sharedTree, (n) => n.children as BiNode[])
      .sum((n) => (n.children.length > 0 ? 0 : n.value.total.value));
    const laid = treemap<BiNode>()
      .tile(aspectTile(treemapSquarify, cw, ch))
      .size([cw, ch])
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
        isLeaf: d.data.children.length === 0,
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
    if (!parent || parent.children.length === 0) return;
    const siblings = parent.children.filter((c) => c !== node) as BiNode[];
    const cur = node.value.total.value;
    const next = Math.max(0, cur + delta);
    const real = next - cur;
    if (real === 0) return;
    // Writing to a branch's total goes through Num.lens, which redistributes
    // the branch's children proportionally — so groups scale naturally.
    node.value.total.value = next;
    let remaining = real;
    if (real > 0) {
      const pool = siblings.filter((s) => s.value.total.value > 0);
      const poolSum = pool.reduce((a, b) => a + b.value.total.value, 0);
      if (poolSum > 0) {
        for (const sib of pool) {
          const share = (sib.value.total.value / poolSum) * real;
          const take = Math.min(sib.value.total.value, share);
          sib.value.total.value -= take;
          remaining -= take;
        }
        for (const sib of siblings) {
          if (remaining <= 0) break;
          const take = Math.min(sib.value.total.value, remaining);
          sib.value.total.value -= take;
          remaining -= take;
        }
      }
    } else if (siblings.length > 0) {
      const sibSum = siblings.reduce((a, b) => a + b.value.total.value, 0);
      if (sibSum > 0) {
        for (const sib of siblings) {
          const share = (sib.value.total.value / sibSum) * -real;
          sib.value.total.value += share;
        }
      } else {
        for (const sib of siblings) sib.value.total.value += -real / siblings.length;
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
      (n.children as BiNode[]).forEach(walk);
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
    return sharedTree.value.total.value;
  });

  // ─── Drag-to-reparent (ghost-commit) ──────────────────────────────────────
  //
  // Ghost-commit gesture: pointer-down on a non-root tile starts a drag.
  // A translucent ghost rect follows the cursor; the drop-target tile (a
  // group node under the pointer that isn't a descendant of the dragged node)
  // gets a highlighted stroke. On release we log the proposal and clear.
  // No structural mutation yet — Path A spike. Esc cancels.
  let gesture = $state.raw<GestureSignalState>(initialGestureState);
  let lastProposalLog = $state<string>("");

  function isAncestor(maybeAncestor: BiNode, target: BiNode): boolean {
    let p: BiNode | undefined = target;
    while (p) {
      if (p === maybeAncestor) return true;
      p = parentOf(sharedTree, p);
    }
    return false;
  }

  /** Hit-test a point against the current tile layout; return the deepest
   *  tile whose rect contains the point. */
  function tileAt(x: number, y: number): { node: BiNode; tile: typeof tiles[number] } | null {
    let best: typeof tiles[number] | null = null;
    for (const t of tiles) {
      if (x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1) {
        if (!best || t.depth > best.depth) best = t;
      }
    }
    return best ? { node: best.node, tile: best } : null;
  }

  /** Choose the proposed new parent: walk up from the hit tile until we find
   *  a node that is (a) not the dragged node, (b) not a descendant of it,
   *  and (c) a branch (has children) — or fall back to the root. */
  function proposeParent(dragged: BiNode, x: number, y: number): { parent: BiNode; index: number } | null {
    const hit = tileAt(x, y);
    if (!hit) return null;
    let candidate: BiNode | undefined = hit.node;
    while (candidate) {
      const isSelf = candidate === dragged;
      const isDescendantOfDragged = isAncestor(dragged, candidate);
      const isBranch = candidate.children.length > 0;
      if (!isSelf && !isDescendantOfDragged && isBranch) {
        // Insert at end for now; index-precision lands when we add gap-targeting.
        return { parent: candidate, index: candidate.children.length };
      }
      candidate = parentOf(sharedTree, candidate);
    }
    return null;
  }

  function svgPoint(e: PointerEvent): { x: number; y: number } {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onPointerDown(e: PointerEvent, t: typeof tiles[number]) {
    // Only left button, only non-root tiles, and not while the wheel-scrub
    // modifier is held (that path stays for resize gestures).
    if (e.button !== 0) return;
    if (t.node === sharedTree) return;
    if (e.metaKey || e.ctrlKey) return;
    const p = svgPoint(e);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    gesture = {
      active: true,
      visual: "ghost",
      writeMode: "commit",
      proposal: null,
      origin: { pointer: p, node: t.node },
      pointer: p,
    };
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!gesture.active || !gesture.origin) return;
    const p = svgPoint(e);
    const draggedNode = gesture.origin.node;
    // Require a small drag distance before showing the ghost, so plain clicks
    // (focus + click-to-focus) still work without flashing a ghost.
    const dx = p.x - gesture.origin.pointer.x;
    const dy = p.y - gesture.origin.pointer.y;
    if (dx * dx + dy * dy < 25) {
      gesture = { ...gesture, pointer: p };
      return;
    }
    const proposed = proposeParent(draggedNode, p.x, p.y);
    const proposal: ReparentProposal | null = proposed
      ? { kind: "reparent", node: draggedNode, newParent: proposed.parent, index: proposed.index }
      : null;
    gesture = { ...gesture, pointer: p, proposal };
  }

  function onPointerUp(_e: PointerEvent) {
    if (!gesture.active) return;
    if (gesture.proposal) {
      const { node, newParent, index } = gesture.proposal;
      lastProposalLog = `would reparent "${node.value.label}" under "${newParent.value.label}" at index ${index}`;
      // Path A: log only. Real structural mutation lands in Path B.
    } else if (gesture.origin) {
      lastProposalLog = `no drop target — cancelled`;
    }
    gesture = initialGestureState;
  }

  function onWindowKeydownEsc(e: KeyboardEvent) {
    if (e.key === "Escape" && gesture.active) {
      gesture = initialGestureState;
      lastProposalLog = "cancelled (Esc)";
    }
  }
  $effect(() => {
    window.addEventListener("keydown", onWindowKeydownEsc);
    return () => window.removeEventListener("keydown", onWindowKeydownEsc);
  });

  // Find the current dragged tile (for the ghost rect geometry).
  const draggedTile = $derived.by(() => {
    if (!gesture.origin) return null;
    return tiles.find((t) => t.node === gesture.origin!.node) ?? null;
  });
  // Find the current drop-target tile (for highlighting).
  const dropTargetTile = $derived.by(() => {
    if (!gesture.proposal) return null;
    return tiles.find((t) => t.node === gesture.proposal!.newParent) ?? null;
  });
</script>

<svg
  width={cw}
  height={ch}
  tabindex="0"
  role="application"
  aria-label="treemap"
  onwheel={onWheel}
  onkeydown={onKeydown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  style="outline: none; font-family: ui-sans-serif, system-ui, sans-serif;"
>
  {#each tiles as t (t.node)}
    {@const w = Math.max(0, t.x1 - t.x0)}
    {@const h = Math.max(0, t.y1 - t.y0)}
    {@const isFocused = focusedNode === t.node}
    {@const isDropTarget = dropTargetTile?.node === t.node}
    {@const isDragged = gesture.active && draggedTile?.node === t.node}
    <rect
      x={t.x0}
      y={t.y0}
      width={w}
      height={h}
      fill={t.node.value.color}
      opacity={t.depth === 0 ? 0.12 : isDragged ? 0.35 : t.isLeaf ? 0.95 : 0.45}
      stroke={isDropTarget ? "#9af542" : isFocused ? "#fff" : t.depth === 0 ? "#444" : "#0b0d12"}
      stroke-width={isDropTarget ? 3 : isFocused ? 2 : 1}
      rx={3}
      style="cursor: {gesture.active ? 'grabbing' : 'pointer'};"
      onclick={() => onTileClick(t)}
      onmouseenter={() => onTileEnter(t)}
      onmouseleave={() => onTileLeave(t)}
      onpointerdown={(e) => onPointerDown(e, t)}
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
        {t.node.value.label}{#if t.isLeaf}
          <tspan x={t.x0 + w / 2} dy="1.2em" font-size="10">{t.node.value.total.value.toFixed(0)}</tspan>
        {/if}
      </text>
    {/if}
  {/each}
  {#if gesture.active && gesture.pointer && draggedTile && gesture.proposal}
    {@const gw = Math.max(20, draggedTile.x1 - draggedTile.x0) / 2}
    {@const gh = Math.max(14, draggedTile.y1 - draggedTile.y0) / 2}
    <rect
      x={gesture.pointer.x - gw / 2}
      y={gesture.pointer.y - gh / 2}
      width={gw}
      height={gh}
      fill={draggedTile.node.value.color}
      opacity={0.65}
      stroke="#9af542"
      stroke-width={2}
      stroke-dasharray="4 3"
      rx={3}
      pointer-events="none"
    />
    <text
      x={gesture.pointer.x}
      y={gesture.pointer.y + gh / 2 + 12}
      text-anchor="middle"
      font-size="10"
      fill="#9af542"
      pointer-events="none"
    >→ {gesture.proposal.newParent.value.label}</text>
  {/if}
  <text x={cw / 2} y={ch - 6} text-anchor="middle" font-size="10" fill="#9aa0a8">
    total: {total.toFixed(0)} · focused: {focusedNode?.value.label ?? "(none)"} · drag tile to reparent · cmd/ctrl+wheel scrub · arrows/Tab{#if lastProposalLog} · {lastProposalLog}{/if}
  </text>
</svg>

<style>
  /* Fill the tile WIDTH; height follows aspect (see SunburstLC for why not 100%). */
  :host { display: block; width: 100%; overflow: hidden; }
</style>
