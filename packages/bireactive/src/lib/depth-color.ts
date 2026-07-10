import { hsl, type HSLColor } from "d3-color";

// Shared color-by-parent depth wash for the hierarchical layouts (sunburst,
// icicle, pack, treemap). Every node keeps its group hue; each deeper level is
// brightened gently so the center stays saturated and the outer levels wash out
// toward — but never to — white. Mirrors LayerChart's color-by-parent mode.
// Tune the wash here once; all four charts pick it up.
const WASH_PER_LEVEL = 0.22;

/** Group hue, brightened by depth. depth 1 (first visible level) = full saturation. */
export function depthFill(baseColor: string, depth: number): HSLColor {
  return hsl(baseColor).brighter(Math.max(0, depth - 1) * WASH_PER_LEVEL);
}

/** Readable label ink for a fill — dark on light tiles, light on dark — by
 *  relative luminance, so labels stay legible as the fills wash out. */
export function labelInk(fill: HSLColor): string {
  const { r, g, b } = fill.rgb();
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return L > 0.55 ? "#1a1d24" : "#fff";
}
