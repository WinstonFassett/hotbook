// LayoutNode — every entity participating in layout has one.
//
// The principle: ANYTHING that consumes pixels (chip, label, padding,
// leaf, sub-GROUP) participates. Nothing is "decoration drawn on top
// of" something else.
//
// Two regimes of layout, with explicit boundaries:
//   • Rigid (anchored)  — node's Box derives from another's Box via a
//     deterministic relation (inset, attach, follow). Used for chrome,
//     containment-with-padding, structural alignment.
//   • Flexible (free)   — node's Box is a solver variable. AVBD moves
//     it to satisfy soft/hard constraints. Used for graph-like
//     arrangement where multiple positions are valid.
//
// A GROUP carries:
//   • outer : Writable<Box>  — free solver variable. AVBD-owned.
//   • content: Box (derived) — anchored to outer via chrome inset.
//   • children: LayoutNode[] — laid out INSIDE content.
//
// A leaf carries:
//   • position : Writable<Vec> — free solver variable.
//   • footprint: Box (derived) — anchored to position via leaf size.
//
// The renderer reads outer (panel + chip) and reads children's
// footprints; never invents its own boxes.

import { Box, box, Vec, vec, type Writable } from "bireactive";

export interface GroupChrome {
  /** Vertical space the chip header consumes inside outer.top. */
  chipHeight: number;
  /** Padding on left/right between outer and content. */
  sidePad: number;
  /** Padding on bottom between content and outer.bottom. */
  bottomPad: number;
}

export interface LeafSize {
  w: number;
  h: number;
}

export interface LayoutNode {
  id: string;
  /** Centre of the node's footprint. For leaves: Writable, free var.
   *  For GROUPs: derived from outer. */
  position: Writable<Vec>;
  /** Box around the node, including chrome. For leaves: derived from
   *  position. For GROUPs: equals outer. */
  footprint: Box;
  /** Empty for leaves; recursive for GROUPs. */
  children: LayoutNode[];
  /** For GROUPs only. */
  outer?: Writable<Box>;
  /** For GROUPs only: outer minus chrome. Children live inside this. */
  content?: Box;
  /** For GROUPs only. */
  chrome?: GroupChrome;
}

export function leafNode(id: string, position: Writable<Vec>, size: LeafSize): LayoutNode {
  const footprint = Box.derive(() => {
    const p = position.value;
    return { x: p.x - size.w / 2, y: p.y - size.h / 2, w: size.w, h: size.h };
  });
  return { id, position, footprint, children: [] };
}

/** Build a GROUP. `outer` is a Writable Box — a solver variable. The
 *  constraint system moves it. `content` is derived from outer minus
 *  chrome (the rigid anchoring relation). Children are constrained
 *  (elsewhere, by callers) to live inside `content`.
 *
 *  Initial outer = bbox of children's footprints inflated by chrome,
 *  as a seed. The solver takes it from there. */
export function groupNode(
  id: string,
  children: LayoutNode[],
  chrome: GroupChrome,
): LayoutNode {
  let xmin = Number.POSITIVE_INFINITY;
  let ymin = Number.POSITIVE_INFINITY;
  let xmax = Number.NEGATIVE_INFINITY;
  let ymax = Number.NEGATIVE_INFINITY;
  for (const c of children) {
    const b = c.footprint.value;
    if (b.x < xmin) xmin = b.x;
    if (b.y < ymin) ymin = b.y;
    if (b.x + b.w > xmax) xmax = b.x + b.w;
    if (b.y + b.h > ymax) ymax = b.y + b.h;
  }
  if (!isFinite(xmin)) { xmin = 0; ymin = 0; xmax = 80; ymax = 60; }

  const ox = xmin - chrome.sidePad;
  const oy = ymin - chrome.chipHeight;
  const ow = (xmax - xmin) + 2 * chrome.sidePad;
  const oh = (ymax - ymin) + chrome.chipHeight + chrome.bottomPad;
  const outer = box(ox, oy, ow, oh);

  // content = outer minus chrome. Rigid anchoring: content derives
  // from outer. When AVBD moves outer, content tracks.
  const content = Box.derive(() => {
    const b = outer.value;
    return {
      x: b.x + chrome.sidePad,
      y: b.y + chrome.chipHeight,
      w: b.w - 2 * chrome.sidePad,
      h: b.h - chrome.chipHeight - chrome.bottomPad,
    };
  });

  // GROUP position = centre of outer, derived. No side-effect writes
  // (the previous version wrote into a Writable inside a derive, which
  // re-entered the reactive graph and emitted "Generator is already
  // running"). LayoutNode's interface says `position: Writable<Vec>`
  // but for GROUPs it's treated as read-only by convention — we
  // expose the derived Vec via a type assertion.
  const position = Vec.derive(() => {
    const b = outer.value;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }) as unknown as Writable<Vec>;

  return {
    id,
    position,
    footprint: outer,
    children,
    outer,
    content,
    chrome,
  };
}

export function leavesOf(node: LayoutNode): LayoutNode[] {
  if (node.children.length === 0) return [node];
  const out: LayoutNode[] = [];
  for (const c of node.children) out.push(...leavesOf(c));
  return out;
}
