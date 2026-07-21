// icicle.ts — MdIcicleLC on the shared hierarchical architecture.
//
// The chart core is `IcicleChart` (hierarchical/icicle-chart.ts): a
// HierarchicalChartBase subclass with rectilinear partition geometry, edge
// handles, and the shared behavior composition (wheel/keyboard/drag/reorder/
// transition/preview). This file wraps it in the legacy BiNode element API
// (data/externalRoot, maxDepth, sortBy, measureKey, orientation, canReorder,
// conservationMode, drillNodeId, onReorder) via the bi-adapter, so existing
// consumers (demos, hotbook, apitable, docs) keep working unchanged.
//
// The previous standalone implementation (Diagram-based, ~870 lines of
// chart-owned gesture logic) is replaced by this composition; see
// wiki/specs/icicle.md and wiki/gesture-architecture.md for the model.

import { IcicleChart } from "../hierarchical/icicle-chart";
import { withBiCompat } from "../hierarchical/bi-adapter";

export class MdIcicleLC extends withBiCompat(IcicleChart, {
  orientation: "horizontal",
}) {}
