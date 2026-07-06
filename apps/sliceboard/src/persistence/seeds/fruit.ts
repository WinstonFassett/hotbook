import type { Dataset } from '../schema/v11'

const NOW = '2026-05-13T12:00:00.000Z'

let _idc = 0
function nid(): string { return `n${++_idc}` }

function row(name: string, measures: Record<string, number>, dims: Record<string, string>, parentId?: string, color?: string) {
  return { id: nid(), parentId: parentId ?? null, index: _idc, name, measures, dims, ...(color ? { color } : {}) }
}

/**
 * Dataset 1 — Fruit (flat + groupBy demo)
 *   Shape: flat (no parentId). 12 rows, 1 measure (value), 2 dims (group, season).
 *   Groups: Alpha (Apples/Bananas/Grapes), Beta (Carrots/Dates/Elderberry),
 *           Gamma (Eggplant/Fennel/Honeydew), Delta (Jackfruit/Kale/Lemon).
 *   Use: exercises flat charts (bar/line/area/pie/radar/concentric-arc/scatter),
 *        groupBy demos (group or season → hierarchy for pack/treemap/icicle/sunburst).
 */
export function buildFruitDataset(): Dataset {
  _idc = 0
  const rows = [
    row('Apples',      { value: 40 }, { group: 'Alpha', season: 'fall' },     undefined, '#e08888'),
    row('Bananas',     { value: 25 }, { group: 'Alpha', season: 'all-year' }, undefined, '#e08888'),
    row('Grapes',      { value: 35 }, { group: 'Alpha', season: 'fall' },     undefined, '#e08888'),
    row('Carrots',     { value: 30 }, { group: 'Beta',  season: 'spring' },   undefined, '#7aaae8'),
    row('Dates',       { value: 15 }, { group: 'Beta',  season: 'all-year' }, undefined, '#7aaae8'),
    row('Elderberry',  { value: 12 }, { group: 'Beta',  season: 'summer' },   undefined, '#7aaae8'),
    row('Eggplant',    { value: 20 }, { group: 'Gamma', season: 'summer' },   undefined, '#b090e0'),
    row('Fennel',      { value: 10 }, { group: 'Gamma', season: 'fall' },     undefined, '#b090e0'),
    row('Honeydew',    { value: 18 }, { group: 'Gamma', season: 'summer' },   undefined, '#b090e0'),
    row('Jackfruit',   { value: 22 }, { group: 'Delta', season: 'all-year' }, undefined, '#7ec87e'),
    row('Kale',        { value: 14 }, { group: 'Delta', season: 'winter' },   undefined, '#7ec87e'),
    row('Lemon',       { value: 28 }, { group: 'Delta', season: 'all-year' }, undefined, '#7ec87e'),
  ]
  return {
    id: 'ds-fruit',
    name: 'Fruit (demo)',
    createdAt: NOW,
    shape: 'flat' as const,
    rows,
    measureDefs: [{ key: 'value', label: 'Value' }],
    dimDefs: [
      { key: 'group', label: 'Group', values: ['Alpha', 'Beta', 'Gamma', 'Delta'] },
      { key: 'season', label: 'Season', values: ['spring', 'summer', 'fall', 'winter', 'all-year'] },
    ],
  }
}
