// treetable.ts — MdTreetableLC on the shared hierarchical architecture.
//
// The chart core is `TreetableChart` (hierarchical/treetable-chart.ts): a
// HierarchicalChartBase subclass with HTML scrollable row rendering, reactive
// value display, and the shared behavior composition (keyboard edit). This file
// wraps it in the legacy BiNode element API (externalRoot, maxDepth, sortBy,
// columns, refresh, enableTransitions, onRender, getRoot) via the bi-adapter,
// so existing consumers (demos, hotbook, apitable, docs) keep working unchanged.
//
// The previous standalone implementation (self-contained MdTreetableLC, ~450
// lines of chart-owned gesture logic) is replaced by this composition; see
// wiki/hierarchical-architecture.md for the model.

import { TreetableChart } from "../hierarchical/treetable-chart";
import { withBiCompat } from "../hierarchical/bi-adapter";
import { portfolio } from "../lib/tree";
import type { BiNode } from "../lib/tree";

export type { ColumnDef } from "../hierarchical/treetable-chart";

export class MdTreetableLC extends withBiCompat(TreetableChart, {}) {
  // Legacy API members are all wired via withBiCompat:
  // - externalRoot (getter/setter for BiNode root)
  // - columns (for column management)
  // - sortBy (for sort order)
  // - maxDepth (for tree depth limiting)
  // - refresh (method for re-rendering)
  // - enableTransitions (property for animation control)
  // - onRender (method for render listener registration)
  // - getRoot (method to get the root element)
  //
  // All of these are inherited from the withBiCompat mixin or TreetableChart base.

  override connectedCallback(): void {
    // Ensure a default portfolio() root exists if none was set
    if (!this.externalRoot) {
      this.externalRoot = portfolio();
    }
    super.connectedCallback();
  }
}
