// Diagram-wide rendering settings. Single shared cell so a toolbar
// control or property panel can drive any spike that reads it.
//
// Per-edge override (when we add it) lives on the Edge row itself
// and falls back to this default when null.

import { cell, type Cell, type Writable } from "@bireactive";

export type EdgeStyle = "straight" | "curved" | "elbow";

export const edgeStyle: Writable<Cell<EdgeStyle>> = cell<EdgeStyle>("elbow");

/** Layout direction — top-to-bottom or left-to-right. Applied uniformly
 *  at every level in spike5's recursive solve. Per-level / per-group
 *  override is a future enhancement (would live on the Row). */
export type Direction = "TB" | "LR";

export const direction: Writable<Cell<Direction>> = cell<Direction>("TB");
