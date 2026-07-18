// sunburst.ts — MdSunburstLC on the shared hierarchical architecture.
//
// The chart core is `SunburstChart` (hierarchical/sunburst-chart.ts): a
// HierarchicalChartBase subclass with radial geometry (arcs, angular
// boundaries, per-arc layout cells). This file wraps it in the legacy BiNode
// element API via the bi-adapter — same contract as MdIcicleLC.
// See wiki/specs/sunburst.md for the six geometry divergences from icicle.
// The previous Diagram-based implementation is in git history
// (feat/gesture-transition-contract, pre-port) — its attachReorderGesture
// angular math and two-lane biEffect settle informed the port.

import { SunburstChart } from "../hierarchical/sunburst-chart";
import { withBiCompat } from "../hierarchical/bi-adapter";

export class MdSunburstLC extends withBiCompat(SunburstChart, { exitFade: true }) {}
