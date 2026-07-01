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

const SORT_ORIENT: VizConfigSchema = {
  pickers: { measure: true, sort: true, orientation: true },
}

const HIER_FULL: VizConfigSchema = {
  pickers: { measure: true, sort: true, depth: true },
  drillKey: 'default',
  showBreadcrumb: true,
}

// Icicle supports an orientation toggle (horizontal partition vs vertical icicle).
const HIER_FULL_ORIENT: VizConfigSchema = {
  pickers: { measure: true, sort: true, depth: true, orientation: true },
  drillKey: 'default',
  showBreadcrumb: true,
}

export const TILE_CONFIG_SCHEMAS: Map<TileKind, VizConfigSchema> = new Map([
  // ─── bireactive LC-port flat charts ───────────────────────────────────────
  ['br-lc-bar',             SORT_ORIENT],
  ['br-lc-bands',           SORT_ORIENT],
  ['br-lc-line',            SORT_ONLY],
  ['br-lc-area',            SORT_ONLY],
  ['br-lc-pie',             SORT_ONLY],
  ['br-lc-radar',           SORT_ONLY],
  ['br-lc-concentric-arc',  SORT_ONLY],

  // ─── scatter — its own X/Y key pickers, no shared measure picker ─────────
  ['br-lc-scatter', {
    pickers: { sort: true, xKey: true, yKey: true },
  }],

  // ─── bireactive LC-port hier charts ───────────────────────────────────────
  ['br-lc-pack',      HIER_FULL],
  ['br-lc-treemap',   HIER_FULL],
  ['br-lc-treetable', HIER_FULL],
  ['br-lc-icicle',    HIER_FULL_ORIENT],
  ['br-lc-sunburst',  HIER_FULL],

  // ─── bireactive LC-port graph charts ──────────────────────────────────────
  ['br-lc-sankey', {
    pickers: { measure: true, sort: true },
    scrollBody: true,
  }],
  ['br-lc-sankey-flow', { pickers: { measure: true, sort: true } }],
  ['br-lc-tree', SORT_ONLY],

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
