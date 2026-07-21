// treemap.ts — MdTreemapLC on the shared hierarchical architecture.
//
// The chart core is `TreemapChart` (hierarchical/treemap-chart.ts): a
// HierarchicalChartBase subclass with squarified nested-rect geometry,
// resize-only drag, and the shared behavior composition (wheel/keyboard/drag/
// transition/preview). This file wraps it in the legacy BiNode element API
// (data/externalRoot, maxDepth, sortBy, measureKey, canReorder,
// conservationMode, drillNodeId, onReorder) via the bi-adapter, so existing
// consumers (demos, hotbook, apitable, docs) keep working unchanged.
//
// The previous standalone implementation (Diagram-based, ~500 lines of
// chart-owned gesture logic) is replaced by this composition; see
// wiki/specs/treemap.md and wiki/gesture-architecture.md for the model.

import { TreemapChart } from "../hierarchical/treemap-chart";
import { withBiCompat } from "../hierarchical/bi-adapter";

export class MdTreemapLC extends withBiCompat(TreemapChart, {}) {}
