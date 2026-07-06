#!/usr/bin/env node
// Hand-run migration check for v12 → v13 (also covers v11 → v13 since the shape
// is the same for pageStacks: both lack them). Mocks localStorage + window,
// stuffs a fixture payload under the legacy key, then loads through the real
// persistence module and asserts the resulting PageStack shape.

import assert from 'node:assert/strict'

// ─── Mock browser env ──────────────────────────────────────────────
const store = new Map()
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: k => { store.delete(k) },
  clear: () => { store.clear() },
  key: i => Array.from(store.keys())[i] ?? null,
  get length() { return store.size },
}
globalThis.window = { innerHeight: 1080 }

// ─── Fixture: minimal v12 payload with two datasets, three dashboards ──
const v12 = {
  datasets: [
    { id: 'ds-a', name: 'A', createdAt: 't', shape: 'flat', rows: [], measureDefs: [{ key: 'v', label: 'V' }], dimDefs: [] },
    { id: 'ds-b', name: 'B', createdAt: 't', shape: 'flat', rows: [], measureDefs: [{ key: 'v', label: 'V' }], dimDefs: [] },
    { id: 'ds-c', name: 'C (no dashboards)', createdAt: 't', shape: 'flat', rows: [], measureDefs: [{ key: 'v', label: 'V' }], dimDefs: [] },
  ],
  dashboards: [
    { id: 'dash-a1', datasetId: 'ds-a', name: 'A1', createdAt: 't', layout: [], tiles: [], measureKey: 'v' },
    { id: 'dash-a2', datasetId: 'ds-a', name: 'A2', createdAt: 't', layout: [], tiles: [], measureKey: 'v' },
    { id: 'dash-b1', datasetId: 'ds-b', name: 'B1', createdAt: 't', layout: [], tiles: [], measureKey: 'v' },
  ],
  activeDatasetId: 'ds-a',
  activeDashboardId: 'dash-a2',
}
store.set('sb:workspace:v12', JSON.stringify(v12))

// ─── Load through the real module ──────────────────────────────────
const { initWorkspace } = await import('../src/persistence.ts')
// Fall back: TS import via tsx if needed.

const ws = initWorkspace()

// ─── Assertions ────────────────────────────────────────────────────
assert.equal(ws.datasets.length, 3, 'datasets preserved')
assert.equal(ws.dashboards.length, 3, 'dashboards preserved')
assert.equal(ws.activeDashboardId, 'dash-a2', 'active dashboard preserved')
assert.ok(Array.isArray(ws.pageStacks), 'pageStacks present')
assert.equal(ws.pageStacks.length, 2, 'one page stack per dataset with dashboards (ds-c excluded)')

const stackA = ws.pageStacks.find(s => s.datasetId === 'ds-a')
const stackB = ws.pageStacks.find(s => s.datasetId === 'ds-b')
assert.ok(stackA && stackB, 'stacks for ds-a and ds-b exist')

// ds-a: active dashboard is dash-a2 → that's the seeded page.
assert.equal(stackA.pages.length, 1, 'ds-a stack has one page')
assert.equal(stackA.pages[0].dashboardId, 'dash-a2', 'ds-a page wraps the active dashboard')
assert.equal(stackA.pages[0].heightPx, 1080, 'heightPx seeded from window.innerHeight')
assert.equal(stackA.activePageIndex, 0)

// ds-b: workspace active dashboard is not in ds-b → falls back to first ds-b dashboard.
assert.equal(stackB.pages.length, 1, 'ds-b stack has one page')
assert.equal(stackB.pages[0].dashboardId, 'dash-b1', 'ds-b page wraps its first dashboard')

// activePageStackId points at the stack matching the active dataset.
assert.equal(ws.activePageStackId, stackA.id, 'active page stack matches active dataset')

// v13 payload is now written; legacy key still present (we don't delete it).
assert.ok(store.has('sb:workspace:v13'), 'v13 payload written')

console.log('OK — v12 → v13 migration produces expected PageStack shape.')
