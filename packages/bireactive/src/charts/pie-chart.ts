// pie-chart.ts — Pie chart as a sunburst preset.
//
// A pie chart is a sunburst with a single level of hierarchy (root → slices)
// and no inner radius (showRoot=false, maxDepth=1). This wrapper accepts
// hierarchical data via `externalRoot` (same API as other hierarchical charts
// like icicle/sunburst/treemap).
//
// The previous standalone Diagram-based implementation is replaced by this
// composition; see wiki/specs/sunburst.md for the radial geometry model.

import { SunburstChart } from "../hierarchical/sunburst-chart";
import { withBiCompat } from "../hierarchical/bi-adapter";

export class MdPieChartLC extends withBiCompat(SunburstChart, {
  exitFade: true,
  showRoot: false,
  maxDepth: 1,
}) {}
