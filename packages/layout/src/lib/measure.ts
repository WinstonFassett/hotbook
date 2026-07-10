// Measure phase — single source of truth for layout footprints.
//
// Every engine (sugiyama, cola, force, dagre) consumes the same `Measured`
// map. The only thing that varies between spikes is how positions are
// produced from these footprints.
//
// Footprints captured here MUST agree with what `render.ts` actually
// paints. If renderer chrome (chip dimensions, hull padding) changes,
// update it here too — that's the whole point of consolidating.

import type { Arr } from "@bireactive";
import type { Edge, Row } from "./data";
import { rowsById, leafIds, items } from "./data";
import { CHIP_HEIGHT_TOTAL, nodeSize, type NodeSize } from "./render";

// Chip glyph metrics — duplicated here so we can compute the chip's own
// width without instantiating shapes. Keep in sync with `renderHull` in
// render.ts (CHIP_PAD_X, CHIP_FONT, CHAR_W).
const CHIP_PAD_X = 7;
const CHIP_FONT = 10.5;
const CHIP_CHAR_W = 0.62;
const CHIP_INSET_X = 8; // left inset of chip inside hull
const CHIP_INSET_Y = 6; // top inset of chip inside hull

export interface LeafFootprint {
  kind: "leaf";
  w: number;
  h: number;
}

export interface GroupFootprint {
  kind: "group";
  /** Inner padding the engine must reserve. `top` reserves chip room. */
  pad: { top: number; bottom: number; left: number; right: number };
  /** The chip header's own footprint (engines that want to position it
   *  explicitly can read this; renderer uses it via INSET constants). */
  chip: { w: number; h: number; insetX: number; insetY: number };
  /** Minimum inner size for an empty group (prevents zero-area boxes
   *  during reparent / removal transitions). */
  minInner: { w: number; h: number };
}

export interface EdgeFootprint {
  kind: "edge";
  /** Label box if the edge has a label. Engines that support edge labels
   *  should declare this footprint to the layout. */
  label?: { w: number; h: number };
}

export interface Measured {
  leaves: Map<string, LeafFootprint>;
  groups: Map<string, GroupFootprint>;
  edges: Map<string, EdgeFootprint>;
}

/** Chip width for a given label, matching `renderHull`'s glyph heuristic. */
export function chipWidth(label: string): number {
  return Math.ceil(label.length * CHIP_FONT * CHIP_CHAR_W) + CHIP_PAD_X * 2;
}

/** Sides shrink slightly with depth — same heuristic as `render.hullPad`,
 *  kept here so engines can ask measure once instead of recomputing. */
function sidePad(depth: number): number {
  return Math.max(8, 14 - depth * 3);
}

/** Build a complete `Measured` from the live tables. Called once per
 *  layout pass (engine-agnostic). */
export function measure(rows: Arr<Row>, edges: Arr<Edge>): Measured {
  const byId = rowsById(rows);
  const leaves = new Set(leafIds(rows));

  // depth of each row from the root — drives side-pad shrinking.
  const depthOf = new Map<string, number>();
  const computeDepth = (id: string): number => {
    if (depthOf.has(id)) return depthOf.get(id)!;
    const pid = byId.get(id)?.parentId.value ?? null;
    const d = pid == null ? 0 : computeDepth(pid) + 1;
    depthOf.set(id, d);
    return d;
  };
  for (const r of items(rows)) computeDepth(r.id);

  const out: Measured = {
    leaves: new Map(),
    groups: new Map(),
    edges: new Map(),
  };

  for (const r of items(rows)) {
    const name = r.name.value;
    if (leaves.has(r.id)) {
      const sz: NodeSize = nodeSize(name);
      out.leaves.set(r.id, { kind: "leaf", w: sz.w, h: sz.h });
    } else {
      const depth = depthOf.get(r.id) ?? 0;
      const side = sidePad(depth);
      const chipW = chipWidth(name);
      out.groups.set(r.id, {
        kind: "group",
        pad: {
          top: CHIP_HEIGHT_TOTAL + 8,
          bottom: side,
          left: side,
          right: side,
        },
        chip: {
          w: chipW,
          h: CHIP_HEIGHT_TOTAL,
          insetX: CHIP_INSET_X,
          insetY: CHIP_INSET_Y,
        },
        minInner: {
          // empty group must be at least wide enough for its chip
          w: Math.max(40, chipW + CHIP_INSET_X * 2),
          h: 32,
        },
      });
    }
  }

  for (const e of items(edges)) {
    out.edges.set(e.id, { kind: "edge" });
  }

  return out;
}
