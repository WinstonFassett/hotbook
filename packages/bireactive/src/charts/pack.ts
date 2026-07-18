// pack.ts — MdPackLC on the shared hierarchical architecture.
//
// The chart core is `PackChart` (hierarchical/pack-chart.ts): a
// HierarchicalChartBase subclass with d3-pack circle geometry,
// resize-only body drag, and the shared behavior composition (wheel/keyboard/
// drag/transition/preview). This file wraps it in the legacy BiNode element
// API (data/externalRoot, maxDepth, sortBy, measureKey, canReorder,
// conservationMode, drillNodeId, onReorder) via the bi-adapter, so existing
// consumers (demos, hotbook, apitable, docs) keep working unchanged.
//
// The previous standalone implementation (Diagram-based, ~400 lines of
// chart-owned gesture logic + viewport tween) is replaced by this
// composition; see wiki/specs/pack.md and wiki/gesture-architecture.md.

import { PackChart } from "../hierarchical/pack-chart";
import { withBiCompat } from "../hierarchical/bi-adapter";

export class MdPack extends withBiCompat(PackChart, {}) {}
