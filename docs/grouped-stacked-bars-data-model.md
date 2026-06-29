# Grouped and Stacked Bar Charts — Data Model Design

## Problem Statement

**Sliceboard's data model is flat:** `PNode[]` with `{ id, name, measures: Record<string, number>, dims?: Record<string, string> }`.

**Grouped/stacked bars require multi-series data:**
```ts
interface GroupedBar {
  id?: string
  label: string
  series: Array<{ name: string; value: number }>
}
```

Each `GroupedBar` is a category on the axis (e.g., "Q1", "North Region", "Product A"). Each `series` entry is one bar segment or stack layer (e.g., different regions, different product lines, different time periods).

## Current Implementation (Proof-of-Concept)

### Transformation Approach

Uses two dimension keys to pivot the flat data:
- **`groupBy`**: dimension that defines categories (rows in `GroupedBar[]`)
- **`seriesBy`**: dimension that splits each category into series segments

Example:
```ts
nodes = [
  { name: "Q1-North", measures: { revenue: 100 }, dims: { quarter: "Q1", region: "North" } },
  { name: "Q1-South", measures: { revenue: 80 }, dims: { quarter: "Q1", region: "South" } },
  { name: "Q2-North", measures: { revenue: 120 }, dims: { quarter: "Q2", region: "North" } },
]

groupBy = "quarter"   // category axis
seriesBy = "region"   // series breakdown
measureKey = "revenue"

// Transformed to:
[
  { label: "Q1", series: [{ name: "North", value: 100 }, { name: "South", value: 80 }] },
  { label: "Q2", series: [{ name: "North", value: 120 }] },
]
```

### Current Limitations

1. **No gesture write-back**: Edits via drag/wheel work on the chart, but don't propagate back to `PNode.measures` via `onUpdate`. The mapping is read-only.
   
2. **Ambiguous reverse mapping**: One segment may aggregate multiple nodes (e.g., if two nodes have the same `groupBy` and `seriesBy` values, their measures sum into one segment). Editing that segment value doesn't have a clear way to split the delta back to the source nodes.

3. **Missing UI**: No pickers for `groupBy` / `seriesBy` / `measureKey`. Users can't configure the chart from the tile settings panel yet.

4. **No hierarchical support**: Can't group by parent/child relationships (e.g., "show revenue by region, broken down by city"). The current groupBy is flat-only.

## Full Design Requirements (from Winston's comment)

> "It is not quite hierarchy. More of a dimensional breakdown that could be hierarchical or not. Is it more like a series? Not deterministic what the dimension and grouping field of that dimension should be. Probably will need to expose these as settings and have pickers."

### What This Means

1. **Pickers needed:**
   - **Category dimension** picker (what goes on the category axis)
   - **Series dimension** picker (what splits each category into segments)
   - **Measure** picker (which measure to visualize)

2. **Hierarchical option:**
   - "Group by parent node" should be an option (e.g., all children of "North Region" become one category, split by product line)
   - Current flat pivot is one mode; hierarchical roll-up is another

3. **Write-back strategy:**
   - When a user drags a segment, the delta must flow back to the source `PNode.measures`
   - Ambiguous case (one segment = many nodes): distribute delta proportionally? Let user pick "primary" node? Flag as read-only?

## Proposed Next Steps

### Phase 1: Settings Panel (Unblock User Configuration)

Add tile config UI:
- Dropdown for `groupBy` (populated from `dataset.dimDefs` or inferred from `node.dims` keys)
- Dropdown for `seriesBy` (same source)
- Dropdown for `measureKey` (from `dataset.measureDefs`)
- Radio for `mode`: grouped | stacked
- Radio for `orientation`: vertical | horizontal

Wire these to `Tile` persistence fields (already added: `groupBy`, `seriesBy`).

### Phase 2: Gesture Write-Back (Make Edits Durable)

Build a `TileSource` variant for grouped data that:
1. Maintains a mapping from `(categoryValue, seriesName) → PNode[]` (the nodes that contributed to that segment)
2. On segment edit, distributes the delta back to those nodes' measures proportionally (by their current values, or equally if ambiguous)
3. Fires `onUpdate(nodeId, measures)` for each affected node
4. Re-derives the `GroupedBar[]` from the updated nodes so the chart stays in sync

This is the same pattern `makeFlatSource` uses for flat cartesian charts, but with the added pivot step.

### Phase 3: Hierarchical Grouping

Add a "Group by hierarchy" mode:
- `groupBy = "_parent"` → each category is a distinct parent node
- `seriesBy` still picks a dimension to split children (or use `"_self"` for one series per child)

Requires walking the tree to collect children per parent, then pivoting within each parent's subtree.

### Phase 4: Advanced Options

- **Sort order**: sort categories by value (sum of series) or by index (original order)
- **Filter**: hide categories with total < threshold
- **Color mapping**: assign series colors from a palette, or let user pick per-series
- **Label thresholds**: hide segment labels when segment is too small (already exists in bar-chart.ts, port to grouped)

## Open Questions

1. **What happens when `seriesBy` dimension is missing on some nodes?**
   - Current impl: they end up in a "default" series. Is that acceptable, or should they be excluded?

2. **Should we allow multi-measure stacking?**
   - e.g., "Revenue" and "Costs" as two series, even though they're different measures?
   - Current data model assumes one measure per chart. Multi-measure would require a measure[] picker.

3. **Gesture priority: which segment is "on top" for hit-testing in stacked mode?**
   - Current impl: first match wins (bottom-to-top in the stack). Should top segment take priority?

4. **Tab navigation across segments: what's the order?**
   - Current impl: TODO. Proposal: flatten all segments into a left-to-right, top-to-bottom order, Tab moves through them.

## References

- WIN-50 (this issue)
- WIN-39 (bar chart orientation work that grouped/stacked deferred from)
- `docs/interaction-principles.md` (gesture rules — scale stability, speculative edits, etc.)
