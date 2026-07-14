/**
 * tile-binder.test.ts — unit tests for TileBinder.
 *
 * Uses fake HTMLElement (jsdom), fake TileSource, and fake bindHud.
 * Covers the behaviors called out in the issue:
 *  1. Echo-suppression: host writes a value → binder does not re-emit
 *  2. Gesture freeze: this tile's own DataViewController is Gesturing → 'gesturing'
 *  3. Cross-tile freeze: another tile's controller is active → this tile frozen
 *  4. Reconcile-by-id when source cardinality changes (shape change → remount)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { bindTile, near, vkey } from '../../src/host/tile-binder'
import type { TileSource } from '../../src/host/tile-binder'
import { DataViewController, gestureCoordinator, type GesturePhase } from '@hotbook/bireactive'

beforeEach(() => {
  gestureCoordinator.setActive(null)
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContainer(): HTMLElement {
  return document.createElement('div')
}

/** A no-op bindHud — tests don't need HUD wiring. */
const noopBindHud = (_el: HTMLElement) => () => {}

interface FakeSource extends TileSource {
  spy: {
    applyCalls: Array<{ phase: GesturePhase; lastRef: Map<string, number> }>
    bindEditOutCalls: number
    mountPropsCalls: number
    syncFromCalls: number
  }
}

/** Build a minimal fake TileSource that records calls. */
function makeFakeSource(shapeKey = 'shape-1'): FakeSource {
  const spy = {
    applyCalls: [] as Array<{ phase: GesturePhase; lastRef: Map<string, number> }>,
    bindEditOutCalls: 0,
    mountPropsCalls: 0,
    syncFromCalls: 0,
  }

  const source: FakeSource = {
    tag: 'x-fake-chart',
    shapeKey,
    spy,
    mountProps(_el) { spy.mountPropsCalls++ },
    initialLast(_el) { return new Map([['a', 1], ['b', 2]]) },
    applyData(_el, opts) { spy.applyCalls.push({ ...opts }) },
    bindEditOut(_el, _lastRef) { spy.bindEditOutCalls++; return () => {} },
    syncFrom(_next) { spy.syncFromCalls++ },
  }

  return source
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('bindTile', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = makeContainer()
    document.body.appendChild(container)
  })

  it('mounts a custom element with the source tag', () => {
    const source = makeFakeSource()
    bindTile(container, source, noopBindHud)
    const el = container.querySelector('x-fake-chart')
    expect(el).toBeTruthy()
    expect(el?.tagName.toLowerCase()).toBe('x-fake-chart')
  })

  it('calls mountProps, initialLast, and applyData on initial mount', () => {
    const source = makeFakeSource()
    bindTile(container, source, noopBindHud)
    expect(source.spy.mountPropsCalls).toBe(1)
    expect(source.spy.applyCalls.length).toBe(1)
    expect(source.spy.applyCalls[0]?.phase).toBe('idle')
  })

  it('calls bindEditOut on mount', () => {
    const source = makeFakeSource()
    bindTile(container, source, noopBindHud)
    expect(source.spy.bindEditOutCalls).toBe(1)
  })

  it('calls bindHud after mount', async () => {
    const bindHudCalls: HTMLElement[] = []
    const source = makeFakeSource()
    bindTile(container, source, (el) => { bindHudCalls.push(el); return () => {} })
    // bindHud is deferred via Promise.resolve().then()
    await Promise.resolve()
    expect(bindHudCalls.length).toBe(1)
  })

  it('dispose removes the element from container', () => {
    const source = makeFakeSource()
    const ctrl = bindTile(container, source, noopBindHud)
    expect(container.children.length).toBe(1)
    ctrl.dispose()
    expect(container.children.length).toBe(0)
  })
})

describe('bindTile.update — same shapeKey (no remount)', () => {
  it('calls syncFrom and applyData, does not remount', () => {
    const container = makeContainer()
    const source = makeFakeSource('s1')
    const ctrl = bindTile(container, source, noopBindHud)
    const initialEl = container.querySelector('x-fake-chart')

    const source2 = makeFakeSource('s1')
    ctrl.update(source2)

    // syncFrom called on the MOUNTED source
    expect(source.spy.syncFromCalls).toBe(1)
    // applyData called again
    expect(source.spy.applyCalls.length).toBe(2)
    // Same element — no remount
    expect(container.querySelector('x-fake-chart')).toBe(initialEl)
  })

  it('echo-suppression: phase stays idle when no gesture is active', () => {
    const container = makeContainer()
    const source = makeFakeSource('s1')
    const ctrl = bindTile(container, source, noopBindHud)

    ctrl.update(makeFakeSource('s1'))

    const calls = source.spy.applyCalls
    expect(calls.every(c => c.phase === 'idle')).toBe(true)
  })
})

describe('bindTile.update — gesture freeze', () => {
  it("passes phase: gesturing when this tile's own DataViewController is Gesturing", () => {
    const container = makeContainer()
    const source = makeFakeSource('s1')
    const ctrl = bindTile(container, source, noopBindHud)

    // The chart owns and attaches its DataViewController as el.dataView.
    const el = container.querySelector('x-fake-chart') as any
    const dv = new DataViewController()
    el.dataView = dv
    dv.start('edit', el) // -> Gesturing, registers as active in the coordinator

    ctrl.update(makeFakeSource('s1'))

    const calls = source.spy.applyCalls
    expect(calls[calls.length - 1]!.phase).toBe('gesturing')
  })

  it('passes phase: idle when its own controller has settled back to Idle', () => {
    const container = makeContainer()
    const source = makeFakeSource('s1')
    const ctrl = bindTile(container, source, noopBindHud)

    const el = container.querySelector('x-fake-chart') as any
    const dv = new DataViewController()
    el.dataView = dv
    dv.start('edit', el); dv.commit(); dv.settle() // Idle again

    ctrl.update(makeFakeSource('s1'))

    const calls = source.spy.applyCalls
    expect(calls[calls.length - 1]!.phase).toBe('idle')
  })
})

describe('bindTile.update — cross-tile freeze (WIN-300)', () => {
  it("passes phase: gesturing when ANOTHER tile's controller is the active gesture", () => {
    const container = makeContainer()
    const source = makeFakeSource('s1')
    const ctrl = bindTile(container, source, noopBindHud)

    const el = container.querySelector('x-fake-chart') as any
    el.dataView = new DataViewController() // this tile: idle

    // A different tile starts a gesture -> it becomes the coordinator's active.
    const otherDv = new DataViewController()
    otherDv.start('reorder', {})

    ctrl.update(makeFakeSource('s1'))

    const calls = source.spy.applyCalls
    expect(calls[calls.length - 1]!.phase).toBe('gesturing') // frozen by the other tile
  })

  it("does NOT freeze while the active tile is only Settling", () => {
    const container = makeContainer()
    const source = makeFakeSource('s1')
    const ctrl = bindTile(container, source, noopBindHud)

    const el = container.querySelector('x-fake-chart') as any
    el.dataView = new DataViewController()

    // Other tile commits -> Settling, and the coordinator is cleared on commit,
    // so other tiles must NOT stay frozen through the settle.
    const otherDv = new DataViewController()
    otherDv.start('reorder', {}); otherDv.commit()

    ctrl.update(makeFakeSource('s1'))

    const calls = source.spy.applyCalls
    expect(calls[calls.length - 1]!.phase).toBe('idle')
  })
})

describe('bindTile.update — shape change (remount)', () => {
  it('dismounts old element and mounts new one when shapeKey changes', () => {
    const container = makeContainer()
    const source = makeFakeSource('shape-A')
    const ctrl = bindTile(container, source, noopBindHud)
    const firstEl = container.querySelector('x-fake-chart')

    const source2 = makeFakeSource('shape-B')
    ctrl.update(source2)

    const secondEl = container.querySelector('x-fake-chart')
    expect(secondEl).not.toBe(firstEl)
    expect(container.children.length).toBe(1)
  })

  it('calls mountProps and applyData again on new source after shape change', () => {
    const container = makeContainer()
    const source = makeFakeSource('shape-A')
    const ctrl = bindTile(container, source, noopBindHud)

    const source2 = makeFakeSource('shape-B')
    ctrl.update(source2)

    // source2 was freshly mounted — should have had mountProps + applyData called
    expect(source2.spy.mountPropsCalls).toBe(1)
    expect(source2.spy.applyCalls.length).toBe(1)
  })

  it('reconcile-by-id: new source with different id set triggers remount', () => {
    const container = makeContainer()
    // shape key encodes the set of ids — different ids → different shapeKey → remount
    const source = makeFakeSource('ids:a,b')
    const ctrl = bindTile(container, source, noopBindHud)

    const source2 = makeFakeSource('ids:a,b,c')  // added c → shape change
    ctrl.update(source2)

    // new element should be present for source2
    expect(source2.spy.applyCalls.length).toBe(1)
  })
})

// ─── near + vkey helpers ──────────────────────────────────────────────────────

describe('near', () => {
  it('returns true for values within epsilon', () => {
    expect(near(1.0, 1.0 + 1e-7)).toBe(true)
  })
  it('returns false for values outside epsilon', () => {
    expect(near(1.0, 1.001)).toBe(false)
  })
})

describe('vkey', () => {
  it('quantizes to 3 decimal places', () => {
    expect(vkey(1.23456789)).toBe('1.235')
  })
  it('treats near-zero as zero', () => {
    expect(vkey(0.0000001)).toBe('0')
  })
  it('distinguishes real fractional edits', () => {
    expect(vkey(1.001)).not.toBe(vkey(1.002))
  })
})
