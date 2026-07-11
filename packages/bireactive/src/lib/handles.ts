import type { AnyShape, Val } from "bireactive";
import { circle, rect, derive, effect as biEffect, cell } from "bireactive";

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
  active?: Val<boolean>;
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
  pos: Val<{ x: number; y: number }>,
  style: HandleStyle,
): AnyShape {
  const radius = style.size ?? 5;

  // Color rules per semantic mode
  let fill: string | Val<string>;
  let stroke: string | Val<string>;

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
 * Oriented parallel to the divider using CSS rotation (not dimension swapping).
 *
 * The pill is always created with the same dimensions (long × short) and then rotated
 * to align with the divider. This keeps the handle anchored to the divider line properly.
 *
 * @param pos Center position (reactive or static {x, y})
 * @param orient Divider orientation — either "horiz"/"vert" for axis-aligned, or an angle in radians for arbitrary rotation
 * @param style Handle appearance and semantic mode
 * @returns Rect shape ready for dragCancelable(...)
 */
export function lineHandle(
  pos: Val<{ x: number; y: number }>,
  orient: Val<"horiz" | "vert" | number>,
  style: HandleStyle,
): AnyShape {
  const longAxis = style.size ?? 14;  // along the divider
  const shortAxis = 6;                // perpendicular thickness

  // Always create the pill horizontally (long × short), then rotate it
  const width = longAxis;
  const height = shortAxis;

  // Center the rect at pos
  const x = derive(() => {
    const p = typeof pos === "object" && "value" in pos ? pos.value : pos;
    return p.x - width / 2;
  });
  const y = derive(() => {
    const p = typeof pos === "object" && "value" in pos ? pos.value : pos;
    return p.y - height / 2;
  });

  // Color rules per semantic mode (same as circleHandle)
  let fill: string | Val<string>;
  let stroke: string | Val<string>;

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

  const handle = rect(x, y, width, height, {
    fill,
    stroke,
    strokeWidth: 1.5,
    corner: shortAxis / 2,  // fully rounded pill
    thin: true,
  });

  // Apply rotation via CSS transform
  // The rotation is anchored at the center of the rect
  handle.el.style.transformOrigin = "center";

  // Reactively update rotation when orientation changes
  biEffect(() => {
    const o = typeof orient === "object" && "value" in orient ? orient.value : orient;
    let rotation: string;

    if (typeof o === "number") {
      // Radians to degrees, then rotate
      // The pill is horizontal by default, so we rotate to match the radial angle
      const degrees = (o * 180) / Math.PI;
      rotation = `rotate(${degrees}deg)`;
    } else {
      // Binary horiz/vert for icicle
      rotation = o === "vert" ? "rotate(90deg)" : "";
    }

    handle.el.style.transform = rotation;
  });

  return handle;
}
