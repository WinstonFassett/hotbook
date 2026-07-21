# Sunburst wraparound divider handle

## Problem

When a parent arc is a full circle (drilled-in node or root with
`showRoot=true`), its N children wrap all the way around. Icicle would have
N-1 dividers; sunburst needs N — the extra one is the seam at 0°/2π where
the last child meets the first child.

## Why it's different

Every other divider is an interior boundary between adjacent siblings —
drag it, one grows, the other shrinks, start point stays fixed. The
wraparound divider is the boundary between child[N-1] and child[0]. Dragging
it moves the "origin" of the whole ring. Visually it looks like rotation:
child[N-1] shrinks from its left, child[0] grows from its right, and
everything appears to rotate around the disc.

## Proposed interaction

1. Grab the wraparound divider at the 0°/2π seam.
2. During drag: reapportion child[N-1] and child[0] (conserve total, same
   as any other divider). The visual effect is rotation — the seam follows
   the cursor, all arcs shift because the start angle moved.
3. On release: snap the layout back to canonical position (child[0] starts
   at 0°) with the new proportions baked in. The rotation unwinds; the
   values stay. Counter-rotation.

## Implementation sketch

- `buildEdges` needs to emit one extra edge for full-circle parents: the
  pair (child[N-1], child[0]) with a flag `wraparound: true`.
- The handle sits at the 0°/2π boundary. During drag, instead of moving
  an interior boundary angle, it shifts an `originOffset` that rotates
  the whole ring. The reapportion math is the same (conserve total between
  the two siblings); the difference is that the layout reads the offset
  and rotates all arcs by it during the drag.
- On release, the offset resets to 0 and the new values are committed.
  The arcs snap to their canonical positions with updated proportions.

## Open questions

- Does the counter-rotation happen instantly on release, or animate?
  Recommendation: animate at `settleMs` so it feels like the ring
  "unwinds" rather than jumping.
- Does this handle exist on non-full-circle parents? No — only when the
  parent wraps all the way around. On slices, the a0/a1 boundaries are
  the parent's own edges (inherited from grandparent), not adjustable
  from this level.
- Multiple full-circle levels? Only the innermost visible level is
  full-circle. Deeper levels are slices within the disc.
