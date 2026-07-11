import type { AnyShape, BiVal, Cell } from "bireactive";
import { circle, rect, derive } from "bireactive";

/**
 * Semantic mode for a handle — determines its color rule.
 *
 * - `divider`: writes two peer values in a sum-preserving way (e.g. adjusting
 *   boundary between adjacent slices). Rendered neutral/translucent.
 * - `value`: writes a single source value. Rendered in the item's color.
 * - `scale`: one drag scales multiple values by a factor, but is tied to one
 *   owning item. Rendered in the item's color.
 */
export type HandleKind = "divider" | "value" | "scale";

export interface HandleStyle {
  /** Semantic mode — determines color treatment. */
  kind: HandleKind;
  /** Item color — required for `value` and `scale` modes. */
  itemColor?: string;
  /** Reactive active/focus state (drives highlight). */
  active?: BiVal<boolean>;
  /** Size override — for circles, the radius; for line handles, the long axis. */
  size?: number;
}

/**
 * Circle handle — default shape for single-value and scale adjusters.
 *
 * @param pos Center position (reactive or static {x, y})
 * @param style Handle appearance and semantic mode
 * @returns Circle shape ready for dragCancelable(...)
 */
export function circleHandle(
  pos: BiVal<{ x: number; y: number }>,
  style: HandleStyle,
): AnyShape {
  const radius = style.size ?? 5;

  // Color rules per semantic mode
  let fill: string | BiVal<string>;
  let stroke: string | BiVal<string>;

  if (style.kind === "divider") {
    // Neutral translucent for dividers
    fill = "rgba(0,0,0,0.55)";
    stroke = style.active
      ? derive(() => (typeof style.active === "object" && "value" in style.active && style.active.value) ? "#fff" : "rgba(0,0,0,0.55)")
      : "rgba(0,0,0,0.55)";
  } else {
    // Item color for value/scale modes
    if (!style.itemColor) {
      throw new Error(`HandleStyle with kind '${style.kind}' requires itemColor`);
    }
    fill = style.itemColor;
    stroke = style.active
      ? derive(() => (typeof style.active === "object" && "value" in style.active && style.active.value) ? "#fff" : "#0b0d12")
      : "#0b0d12";
  }

  return circle(pos, radius, {
    fill,
    stroke,
    strokeWidth: 1.5,
  });
}

/**
 * Line/edge handle — oblong pill shape for divider handles on line-shaped dividers.
 * Oriented parallel to the divider (long axis) with short perpendicular thickness.
 *
 * @param pos Center position (reactive or static {x, y})
 * @param orient Divider orientation — determines whether handle is horizontal or vertical
 * @param style Handle appearance and semantic mode
 * @returns Rect shape ready for dragCancelable(...)
 */
export function lineHandle(
  pos: BiVal<{ x: number; y: number }>,
  orient: BiVal<"horiz" | "vert">,
  style: HandleStyle,
): AnyShape {
  const longAxis = style.size ?? 14;  // along the divider
  const shortAxis = 6;                // perpendicular thickness

  // Compute width/height based on orientation
  const width = derive(() => {
    const o = typeof orient === "object" && "value" in orient ? orient.value : orient;
    return o === "horiz" ? longAxis : shortAxis;
  });
  const height = derive(() => {
    const o = typeof orient === "object" && "value" in orient ? orient.value : orient;
    return o === "horiz" ? shortAxis : longAxis;
  });

  // Center the rect at pos
  const x = derive(() => {
    const p = typeof pos === "object" && "value" in pos ? pos.value : pos;
    const w = typeof width === "object" && "value" in width ? width.value : width;
    return p.x - w / 2;
  });
  const y = derive(() => {
    const p = typeof pos === "object" && "value" in pos ? pos.value : pos;
    const h = typeof height === "object" && "value" in height ? height.value : height;
    return p.y - h / 2;
  });

  // Color rules per semantic mode (same as circleHandle)
  let fill: string | BiVal<string>;
  let stroke: string | BiVal<string>;

  if (style.kind === "divider") {
    fill = "rgba(0,0,0,0.55)";
    stroke = style.active
      ? derive(() => (typeof style.active === "object" && "value" in style.active && style.active.value) ? "#fff" : "rgba(0,0,0,0.55)")
      : "rgba(0,0,0,0.55)";
  } else {
    if (!style.itemColor) {
      throw new Error(`HandleStyle with kind '${style.kind}' requires itemColor`);
    }
    fill = style.itemColor;
    stroke = style.active
      ? derive(() => (typeof style.active === "object" && "value" in style.active && style.active.value) ? "#fff" : "#0b0d12")
      : "#0b0d12";
  }

  return rect(x, y, width, height, {
    fill,
    stroke,
    strokeWidth: 1.5,
    corner: shortAxis / 2,  // fully rounded pill
    thin: true,
  });
}
