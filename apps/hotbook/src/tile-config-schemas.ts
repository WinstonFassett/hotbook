import type { VizConfigSchema } from '@hotbook/core'
import type { TileKind } from './persistence'

// Per-chart capability declarations. TileCard reads from this registry to
// decide which pickers to render and how to lay out the tile body. Adding
// a new chart kind means adding one entry here — no edits to TileCard.
//
// Retired kinds (gen-0 flat morph trio, gen-0 hier D3, Svelte ports) get
// minimal entries so legacy persisted dashboards still render without
// throwing when looked up.

const EMPTY: VizConfigSchema = { pickers: {} }

const SORT_ONLY: VizConfigSchema = {
  pickers: { measure: true, sort: true },
}

const SORT_ORIENT: VizConfigSchema = {
  pickers: { measure: true, sort: true, orientation: true },
}

const HIER_FULL: VizConfigSchema = {
  pickers: { measure: true, sort: true, depth: true, groupBy: true },
  drillKey: 'default',
  showBreadcrumb: true,
}

// Icicle supports an orientation toggle (horizontal partition vs vertical icicle).
const HIER_FULL_ORIENT: VizConfigSchema = {
  pickers: { measure: true, sort: true, depth: true, orientation: true, groupBy: true },
  drillKey: 'default',
  showBreadcrumb: true,
}

export const TILE_CONFIG_SCHEMAS: Map<TileKind, VizConfigSchema> = new Map([
  // ─── bireactive LC-port flat charts ───────────────────────────────────────
  ['bar',             SORT_ORIENT],
  ['bands',           SORT_ORIENT],
  ['line',            SORT_ONLY],
  ['area',            SORT_ONLY],
  ['pie',             SORT_ONLY],
  ['radar',           SORT_ONLY],
  ['concentric-arc',  SORT_ONLY],

  // ─── scatter — its own X/Y key pickers, no shared measure picker ─────────
  ['scatter', {
    pickers: { sort: true, xKey: true, yKey: true },
  }],

  // ─── bireactive LC-port hier charts ───────────────────────────────────────
  ['pack',      HIER_FULL],
  ['treemap',   HIER_FULL],
  ['treetable', HIER_FULL],
  ['icicle',    HIER_FULL_ORIENT],
  ['sunburst',  HIER_FULL],

  // ─── bireactive LC-port graph charts ──────────────────────────────────────
  ['sankey', {
    pickers: { measure: true, sort: true },
    scrollBody: true,
  }],
  ['tree', HIER_FULL_ORIENT],

  // ─── Retired kinds: no pickers, no scroll — entries exist so a lookup
  //     never returns undefined for a legacy persisted tile.
  ['treemap',                  EMPTY],
  ['radial',                   EMPTY],
  ['h-treemap',                EMPTY],
  ['h-icicle',                 EMPTY],
  ['h-radial',                 EMPTY],
  ['svelte-sunburst',    EMPTY],
  ['svelte-icicle',      EMPTY],
  ['svelte-pack',        EMPTY],
  ['svelte-treemap',     EMPTY],
  ['svelte-treemap-demo',      EMPTY],
])

export function schemaFor(kind: TileKind): VizConfigSchema {
  return TILE_CONFIG_SCHEMAS.get(kind) ?? EMPTY
}
