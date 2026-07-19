// radial-chart-base.ts — shared base for radial/polar charts.
//
// Extends CartesianChartBase with radial-specific helpers (center, radius,
// angle conventions). The SVG surface, host size, Gesture/Editor, HUD bridge,
// anim clock, and behavior composition are all inherited from
// CartesianChartBase.
//
// Radial charts (concentric-arc, gauge, gauge-segmented, radar) use polar
// coordinates — a center point, a radius, and angular sweeps — instead of
// cartesian x/y scales. This base provides reactive helpers for those
// quantities so subclasses don't each re-derive them.

import { derive, type Cell } from "bireactive";
import { CartesianChartBase, type FlatItem } from "../cartesian/cartesian-chart-base";

export type { FlatItem };

export class RadialChartBase extends CartesianChartBase {
  /** Center x (reactive, tracks host width). */
  protected _cx = derive(() => (this._hostSize ? this._hostSize.w.value / 2 : 0));
  /** Center y (reactive, tracks host height). */
  protected _cy = derive(() => (this._hostSize ? this._hostSize.h.value / 2 : 0));
  /** Max radius (reactive, tracks min of width/height). */
  protected _rMax = derive(() => {
    if (!this._hostSize) return 0;
    return Math.min(this._hostSize.w.value, this._hostSize.h.value) / 2;
  });

  /** Get the current center point as {x, y}. */
  protected _center() {
    return { x: this._cx.value, y: this._cy.value };
  }
}
