// Project phase — apply group chrome (chip header + side padding) to a
// raw rectangle map produced by an engine that knows only leaf sizes.
//
// Engines like dagre compute tight subgraph rects from child extents; they
// don't know our group rects need a chip-height inset at the top. This
// post-process walks the containment tree deepest-first and shifts each
// container's subtree down by its measured `pad.top`, then recomputes the
// container rect from the (now padded) children.
//
// Engines that ARE chip-aware (force/cola via reactive hulls; sugiyama
// via hullPad) don't need this — they declare the chrome at the
// constraint layer. Project is the "fix the lie" phase for chrome-blind
// engines.

import type { Measured } from "./measure";

export interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProjectInput {
  /** Rects produced by the engine. Mutated in place. Must contain every
   *  leaf and (for chrome-blind engines like dagre) a tight rect per
   *  group. */
  rectOf: Map<string, NodeRect>;
  /** Parent → children adjacency, derived from sharedRows. */
  childrenOf: Map<string, string[]>;
  /** All container ids (rows with at least one child). */
  groupIds: Iterable<string>;
  measured: Measured;
}

/** Walk groups deepest-first, shift each subtree down by its `pad.top`,
 *  then recompute its rect as bounding box of (now padded) children plus
 *  left/right/bottom pad. Leaf rects are translated; group rects are
 *  rewritten. */
export function applyGroupChrome(input: ProjectInput): void {
  const { rectOf, childrenOf, groupIds, measured } = input;

  // depth of each group (max distance to deepest descendant group).
  const groupSet = new Set(groupIds);
  const depthOf = new Map<string, number>();
  const computeDepth = (id: string): number => {
    if (depthOf.has(id)) return depthOf.get(id)!;
    const kids = childrenOf.get(id) ?? [];
    let d = 0;
    for (const k of kids) {
      if (groupSet.has(k)) d = Math.max(d, 1 + computeDepth(k));
      else d = Math.max(d, 1);
    }
    depthOf.set(id, d);
    return d;
  };
  for (const id of groupSet) computeDepth(id);
  const ordered = [...groupSet].sort((a, b) => depthOf.get(b)! - depthOf.get(a)!);

  const allDescendants = (gid: string): string[] => {
    const out: string[] = [];
    const queue = [...(childrenOf.get(gid) ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      out.push(id);
      const kids = childrenOf.get(id);
      if (kids) queue.push(...kids);
    }
    return out;
  };

  for (const gid of ordered) {
    const fp = measured.groups.get(gid);
    if (!fp) continue;
    const subtree = allDescendants(gid);
    if (subtree.length === 0) continue;

    // Shift entire subtree down by this group's chip-header pad so the
    // chip has room above the topmost child.
    for (const id of subtree) {
      const r = rectOf.get(id);
      if (r) r.y += fp.pad.top;
    }

    // Recompute this group's rect = bounding box of its DIRECT children
    // (now padded), expanded by this group's chrome.
    let xmin = Number.POSITIVE_INFINITY;
    let ymin = Number.POSITIVE_INFINITY;
    let xmax = Number.NEGATIVE_INFINITY;
    let ymax = Number.NEGATIVE_INFINITY;
    for (const child of childrenOf.get(gid) ?? []) {
      const r = rectOf.get(child);
      if (!r) continue;
      xmin = Math.min(xmin, r.x);
      ymin = Math.min(ymin, r.y);
      xmax = Math.max(xmax, r.x + r.w);
      ymax = Math.max(ymax, r.y + r.h);
    }
    if (!Number.isFinite(xmin)) continue;

    rectOf.set(gid, {
      x: xmin - fp.pad.left,
      y: ymin - fp.pad.top,
      w: (xmax - xmin) + fp.pad.left + fp.pad.right,
      h: (ymax - ymin) + fp.pad.top + fp.pad.bottom,
    });
  }
}
