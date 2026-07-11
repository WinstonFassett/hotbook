# Axis Binding Redesign

Replace `measureKey` + `sortBy` + `orientation` with a unified **accessor binding** model inspired by LayerChart/LayerCake.

## Problem

The current model conflates three concepts:
- **measureKey**: which numeric field drives the chart's value
- **sortBy**: how categorical slots are ordered (`'index'` | `'value'`)
- **orientation**: which screen axis is categorical vs value (bar/bands only)

These are plumbed separately through tile-sources → bindTile → each chart. The result is a mess of special cases:
- Scatter has `xKey` AND `yKey` AND `measureKey` (which is yKey)
- Line/area have `reindex` hacks that rewrite dates on sort
- Bar has `orientation` as a reactive cell but `sortBy` baked into the data order
- Each chart has its own gate logic checking different combinations

## Core insight from LayerChart

LayerChart has no `measureKey`, no `sortBy`. It has **accessors**:
```
<Chart x="date" y="revenue" data={rows}>
```
- Change the y-axis? `y="profit"`. Scale re-derives. Marks follow.
- Sort? That's `xDomainSort` or a domain function. Not a separate concept.
- Marks ALWAYS read through `ctx.xGet`/`ctx.yGet` — never raw `d.x`/`d.y`.

This makes transitions trivial: change an accessor → scale re-derives → tween cells animate → marks follow. No special cases per chart type.

## New model

### Cartesian charts (scatter, line, area)

```
xBinding: string    // which field maps to x ('date', '_index', 'revenue', ...)
yBinding: string    // which field maps to y ('revenue', 'profit', ...)
```

- "Change measure" = change `yBinding` (or `xBinding` for scatter)
- "Sort by value" = change `xBinding` from `'date'` to `'_valueRank'` (line/area)
- No separate sort concept. Sort is just an x-axis rebind.
- Both bindings are reactive cells. Gate fires on either change. Marks tween.

### Slot charts (bar, pie, radar, concentric-arc)

```
valueBinding: string     // which field drives each slot's value
orderBinding: string     // how slots are ordered: 'index' | 'value' | field name
orientation?: string     // bar/bands only: 'vertical' | 'horizontal'
```

- "Change measure" = change `valueBinding`
- "Sort by value" = change `orderBinding` from `'index'` to `'value'`
- Both are reactive cells. Gate fires on either change. Marks tween.
- Orientation is a separate reactive cell (bar/bands only).

## Architecture

### The tween layer (the key fix)

The fundamental bug that caused all the scatter/line/area sort jumps: **marks read raw datum values while tween cells animated to nowhere.**

Fix: marks NEVER read raw values. They read through **tweened scale getters**:

```
// chart-context provides:
xGet: (d) => xScale(tweenedX(d))    // NOT xScale(xAcc(d))
yGet: (d) => yScale(tweenedY(d))    // NOT yScale(yAcc(d))
```

Where `tweenedX(d)` and `tweenedY(d)` are per-datum tween cells that:
- SNAP on value edits (same binding, different value) — write-through, no lag
- TWEEN on binding change (accessor changed) — animate to new positions

This is the LayerChart pattern: marks read through the context, never raw values. Our context just adds a tween layer between the scale and the marks.

### Per-datum tween cells

Each datum gets a tween cell per axis. The cell holds the current *visual* value (which may be mid-tween). The gate classifies each change:

```
structural = binding changed (xBinding/yBinding/valueBinding/orderBinding)
structural && !gestureActive  → TWEEN
else                          → SNAP
```

Same two-lane gate as WIN-143, but unified across all charts.

### Slot charts: order as a layout input

For slot charts, `orderBinding` determines the slot assignment (which datum goes in which slot). When it changes:
1. Reorder the data array by the new order
2. Each datum's slot position changes
3. Tween cells animate positions to new slots

For bar: x/y/w/h all tween (bar moves to new slot, grows/shrinks to new value if valueBinding also changed).
For pie: a0/a1 tween (slice rotates to new angular position).
For radar: radius tweens (vertex moves to new spoke).
For concentric-arc: rOuter tweens (ring moves to new rank).

### What goes away

- `measureKey` → replaced by `yBinding` (cartesian) or `valueBinding` (slot)
- `sortBy` → replaced by `xBinding` (cartesian) or `orderBinding` (slot)
- `reindex` → gone. No date rewriting. Accessors read from the datum directly.
- `xKey` on scatter → just `xBinding`
- Per-chart gate logic → unified gate in chart-context (cartesian) or a shared slot-chart helper

### What stays

- `orientation` on bar/bands — still a reactive cell, still tweens x/y/w/h
- `GESTURE_ACTIVE_CLASS` gate — still suppresses tweens during gestures
- `gesturecommit` with `{ detail: { canceled } }` — still triggers post-gesture reorder
- `applyData` frozen/commit branches — still hold order during gestures, reorder on release

## Implementation plan

1. **chart-context.ts**: Add tween layer. `xGet`/`yGet` read through per-datum tween cells. Gate fires on accessor change (passed as cells, not static accessors).

2. **scatter-chart.ts**: Replace `measureKey` + `xKey` with `xBinding` + `yBinding` cells. Dots read through `ctx.xGet`/`ctx.yGet` (already fixed). Gate fires on either binding change.

3. **line-chart.ts / area-chart.ts**: Replace `measureKey` with `yBinding` cell. `xBinding` stays `'date'` (or `'_index'`). Remove `reindex`. Spline + focus circles + hover + selection all read through tween getters (already fixed). Gate fires on `yBinding` change.

4. **bar-chart.ts**: Replace `measureKey` with `valueBinding` cell. Add `orderBinding` cell. Gate fires on `valueBinding` OR `orderBinding` OR `orientation` change. Bar x/y/w/h tween on any of these.

5. **pie-chart.ts**: Replace `measureKey` with `valueBinding` cell. Add `orderBinding` cell. Per-slice `a0`/`a1` angle tweens fire on `valueBinding` OR `orderBinding` change.

6. **radar-chart.ts**: Same as pie — `valueBinding` + `orderBinding` cells. Per-spoke radius tweens fire on either change.

7. **concentric-arc.ts**: Same — `valueBinding` + `orderBinding` cells. Per-ring `rOuter` + `frac` tweens fire on either change.

8. **tile-sources.ts**: Emit `xBinding`/`yBinding` (cartesian) or `valueBinding`/`orderBinding` (slot) via `mountProps`. Remove `measureKey` from `shapeKey` (already done). Remove `sortBy` from `shapeKey`. Remove `reindex`.

9. **bindTile.ts**: `applyData` sets binding cells via `mountProps` (already calls `mountProps` before data writes). No `reindex`. No `measureKey` on the element.

## What "sort by value" means per chart

| Chart | "Sort by value" | Implementation |
|-------|----------------|----------------|
| Scatter | Not applicable — no inherent order | N/A |
| Line/area | Rebind x from date to value-rank | `xBinding: '_valueRank'` |
| Bar/bands | Reorder bands by value desc | `orderBinding: 'value'` |
| Pie | Reorder slices by value desc | `orderBinding: 'value'` |
| Radar | Reorder spokes by value desc | `orderBinding: 'value'` |
| Concentric-arc | Reorder rings by value desc | `orderBinding: 'value'` |

For line/area, "sort by value" produces a rank plot (x = value-rank, y = value). This is a legitimate visualization (bump chart / rank chart). Whether to offer it is a UX decision, not a technical one. The architecture supports it either way.
