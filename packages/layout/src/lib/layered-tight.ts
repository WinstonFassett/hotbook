// `layeredTight` — local fork of bireactive/propagators `layered()` with
// non-uniform layer spacing. Same Sugiyama machinery (rank → barycenter
// sweeps → coordinate assignment), but each pair of adjacent layers is
// placed at `(halfPrev + halfThis) / 1 + layerPad` instead of a uniform
// `l * layerGap`. That stops one tall layer from forcing the same gap
// between every pair.
//
// Forked rather than monkey-patched so this spike can iterate without
// touching inspo/bireactive. If a future inspo version exposes a
// `layerGap: (l) => number` hook we can swap back.

import { rank } from "bireactive/propagators";

import type { Graph, Placement, Size } from "bireactive/propagators";

type Direction = "TB" | "BT" | "LR" | "RL";

export interface LayeredTightOpts<N> {
  direction?: Direction;
  /** Edge-to-edge padding between adjacent layers. Default 28. */
  layerPad?: number;
  /** Minimum edge-to-edge distance within a layer. Default 28. */
  nodeGap?: number;
  /** Intrinsic node size. Default 46×34. */
  sizeOf?: (n: N) => Size;
  /** Crossing-reduction sweeps. Default 6. */
  sweeps?: number;
  /** Barycenter source. Default "both". */
  align?: "both" | "down" | "up";
}

const DEFAULT_SIZE: Size = { w: 46, h: 34 };

// ── crossing reduction (private in inspo; inlined here) ──────────────

function ordered<N>(g: Graph<N>, layer: Map<N, number>, sweeps: number): N[][] {
  const numLayers = Math.max(0, ...[...layer.values()].map((l) => l + 1));
  const layers: N[][] = Array.from({ length: numLayers }, () => []);
  for (const n of g.nodes) layers[layer.get(n)!]!.push(n);

  const down = new Map<N, N[]>();
  const up = new Map<N, N[]>();
  for (const n of g.nodes) {
    down.set(n, []);
    up.set(n, []);
  }
  for (const [u, v] of g.edges) {
    const lu = layer.get(u)!;
    const lv = layer.get(v)!;
    if (lu === lv) continue;
    const [hiNode, loNode] = lu < lv ? [u, v] : [v, u];
    down.get(hiNode)!.push(loNode);
    up.get(loNode)!.push(hiNode);
  }

  const indexIn = (arr: N[]): Map<N, number> =>
    new Map<N, number>(arr.map((n, i) => [n, i]));
  const sweep = (
    from: number,
    to: number,
    step: number,
    side: Map<N, N[]>,
  ): void => {
    for (let l = from; l !== to; l += step) {
      const ref = indexIn(layers[l - step]!);
      const bary = (n: N): number => {
        const nb = side.get(n)!;
        if (nb.length === 0) return Number.POSITIVE_INFINITY;
        let acc = 0;
        for (const m of nb) acc += ref.get(m)!;
        return acc / nb.length;
      };
      const b = new Map<N, number>(layers[l]!.map((n) => [n, bary(n)]));
      layers[l]!.sort((p, q) => {
        const bp = b.get(p)!;
        const bq = b.get(q)!;
        if (!Number.isFinite(bp) || !Number.isFinite(bq)) return 0;
        return bp - bq;
      });
    }
  };

  for (let s = 0; s < sweeps; s++) {
    if (numLayers > 1) sweep(1, numLayers, 1, up);
    if (numLayers > 1) sweep(numLayers - 2, -1, -1, down);
  }
  return layers;
}

// ── coordinate assignment (private in inspo; inlined here) ───────────

function isotonic(y: number[]): number[] {
  const blocks: Array<{ sum: number; count: number }> = [];
  for (const yi of y) {
    let b = { sum: yi, count: 1 };
    while (
      blocks.length > 0 &&
      blocks[blocks.length - 1]!.sum / blocks[blocks.length - 1]!.count >
        b.sum / b.count
    ) {
      const prev = blocks.pop()!;
      b = { sum: prev.sum + b.sum, count: prev.count + b.count };
    }
    blocks.push(b);
  }
  const out: number[] = [];
  for (const block of blocks) {
    const avg = block.sum / block.count;
    for (let k = 0; k < block.count; k++) out.push(avg);
  }
  return out;
}

function placeRow(sizes: number[], desired: number[], gap: number): number[] {
  const n = sizes.length;
  if (n === 0) return [];
  const cumSep: number[] = new Array(n);
  cumSep[0] = 0;
  for (let i = 1; i < n; i++)
    cumSep[i] = cumSep[i - 1]! + sizes[i - 1]! / 2 + gap + sizes[i]! / 2;
  const q = desired.map((d, i) => d - cumSep[i]!);
  const qhat = isotonic(q);
  return qhat.map((v, i) => v + cumSep[i]!);
}

function normalize<N>(
  p: Map<N, Placement>,
  pad: number,
): Map<N, Placement> {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const b of p.values()) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
  }
  if (!Number.isFinite(minX)) return p;
  for (const [n, b] of p)
    p.set(n, { ...b, x: b.x - minX + pad, y: b.y - minY + pad });
  return p;
}

// ── the fork ─────────────────────────────────────────────────────────

export function layeredTight<N>(
  g: Graph<N>,
  opts: LayeredTightOpts<N> = {},
): Map<N, Placement> {
  const dir = opts.direction ?? "TB";
  const layerPad = opts.layerPad ?? 28;
  const nodeGap = opts.nodeGap ?? 28;
  const sizeOf = opts.sizeOf ?? (() => DEFAULT_SIZE);
  const sweeps = opts.sweeps ?? 6;
  const align = opts.align ?? "both";

  const layer = rank(g);
  const layers = ordered(g, layer, sweeps);
  const horizontal = dir === "LR" || dir === "RL";

  const cross = (n: N): number => (horizontal ? sizeOf(n).h : sizeOf(n).w);
  const along = (n: N): number => (horizontal ? sizeOf(n).w : sizeOf(n).h);

  // Barycenter neighbour sets.
  const nbrs = new Map<N, N[]>();
  for (const n of g.nodes) nbrs.set(n, []);
  for (const [u, v] of g.edges) {
    const lu = layer.get(u)!;
    const lv = layer.get(v)!;
    if (lu === lv) continue;
    const hiNode = lu < lv ? u : v;
    const loNode = lu < lv ? v : u;
    if (align !== "up") nbrs.get(hiNode)!.push(loNode);
    if (align !== "down") nbrs.get(loNode)!.push(hiNode);
  }

  // Initial cross-axis centres: pack each layer from 0.
  const center = new Map<N, number>();
  for (const arr of layers) {
    let c = 0;
    for (let i = 0; i < arr.length; i++) {
      const half = cross(arr[i]!) / 2;
      c += half;
      center.set(arr[i]!, c);
      c += half + nodeGap;
    }
  }

  // Refinement: pull toward neighbour barycenter, re-resolve overlaps.
  const refine = (order: number[]): void => {
    for (const li of order) {
      const arr = layers[li]!;
      if (arr.length === 0) continue;
      const desired = arr.map((n) => {
        const nb = nbrs.get(n)!.filter((m) => layer.get(m) !== li);
        if (nb.length === 0) return center.get(n)!;
        let acc = 0;
        for (const m of nb) acc += center.get(m)!;
        return acc / nb.length;
      });
      const placed = placeRow(arr.map(cross), desired, nodeGap);
      arr.forEach((n, i) => center.set(n, placed[i]!));
    }
  };
  const numLayers = layers.length;
  const downOrder = Array.from({ length: numLayers }, (_, i) => i);
  const upOrder = [...downOrder].reverse();
  for (let s = 0; s < sweeps; s++) {
    refine(downOrder);
    refine(upOrder);
  }

  // ── the only real difference from inspo's layered() ────────────────
  // Cumulative per-pair layer centres: each pair of adjacent layers is
  // placed (halfPrev + halfThis) + layerPad apart, instead of all pairs
  // sharing a uniform `layerGap`.
  const maxAlongPerLayer = new Array<number>(numLayers).fill(0);
  for (const n of g.nodes) {
    const l = layer.get(n)!;
    maxAlongPerLayer[l] = Math.max(maxAlongPerLayer[l]!, along(n));
  }
  const layerCenters = new Array<number>(numLayers);
  if (numLayers > 0) layerCenters[0] = 0;
  for (let l = 1; l < numLayers; l++) {
    const span =
      (maxAlongPerLayer[l - 1]! + maxAlongPerLayer[l]!) / 2 + layerPad;
    layerCenters[l] = layerCenters[l - 1]! + span;
  }
  const layerCenter = (l: number): number => layerCenters[l]!;
  // ───────────────────────────────────────────────────────────────────

  const maxLayer = numLayers - 1;
  const out = new Map<N, Placement>();
  for (const n of g.nodes) {
    const { w, h } = sizeOf(n);
    const l = layer.get(n)!;
    const cc = center.get(n)!;
    let lc = layerCenter(l);
    if (dir === "BT" || dir === "RL") lc = layerCenter(maxLayer) - lc;
    const cx = horizontal ? lc : cc;
    const cy = horizontal ? cc : lc;
    out.set(n, { x: cx - w / 2, y: cy - h / 2, w, h });
  }
  return normalize(out, 0);
}
