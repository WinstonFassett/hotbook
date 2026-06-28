import type { VizConfigSchema } from '@winstonfassett/vizform-core'
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

const SORT_AND_GROUPBY: VizConfigSchema = {
  pickers: { measure: true, sort: true, groupBy: true },
}

const HIER_FULL: VizConfigSchema = {
  pickers: { measure: true, sort: true, groupBy: true, depth: true },
}

export const TILE_CONFIG_SCHEMAS: Map<TileKind, VizConfigSchema> = new Map([
  // ─── treetable ────────────────────────────────────────────────────────────
  ['treetable', { pickers: { measure: true } }],

  // ─── bireactive LC-port flat charts ───────────────────────────────────────
  ['br-lc-bar',             SORT_AND_GROUPBY],
  ['br-lc-bands',           SORT_ONLY],
  ['br-lc-line',            SORT_AND_GROUPBY],
  ['br-lc-area',            SORT_AND_GROUPBY],
  ['br-lc-pie',             SORT_AND_GROUPBY],
  ['br-lc-radar',           SORT_AND_GROUPBY],
  ['br-lc-concentric-arc',  SORT_AND_GROUPBY],

  // ─── scatter — its own X/Y key pickers, no shared measure picker ─────────
  ['br-lc-scatter', {
    pickers: { sort: true, xKey: true, yKey: true },
  }],

  // ─── bireactive LC-port hier charts ───────────────────────────────────────
  ['br-lc-pack',     HIER_FULL],
  ['br-lc-treemap',  HIER_FULL],
  ['br-lc-icicle',   HIER_FULL],
  ['br-lc-sunburst', HIER_FULL],

  // ─── bireactive LC-port graph charts ──────────────────────────────────────
  ['br-lc-sankey', {
    pickers: { measure: true, sort: true, groupBy: true },
    scrollBody: true,
  }],
  ['br-lc-sankey-flow', { pickers: { measure: true, sort: true } }],
  ['br-lc-tree', SORT_AND_GROUPBY],

  // ─── Retired kinds: no pickers, no scroll — entries exist so a lookup
  //     never returns undefined for a legacy persisted tile.
  ['treemap',                  EMPTY],
  ['radial',                   EMPTY],
  ['bands',                    EMPTY],
  ['h-treemap',                EMPTY],
  ['h-icicle',                 EMPTY],
  ['h-radial',                 EMPTY],
  ['svelte-br-lc-sunburst',    EMPTY],
  ['svelte-br-lc-icicle',      EMPTY],
  ['svelte-br-lc-pack',        EMPTY],
  ['svelte-br-lc-treemap',     EMPTY],
  ['svelte-treemap-demo',      EMPTY],
])

export function schemaFor(kind: TileKind): VizConfigSchema {
  return TILE_CONFIG_SCHEMAS.get(kind) ?? EMPTY
}
