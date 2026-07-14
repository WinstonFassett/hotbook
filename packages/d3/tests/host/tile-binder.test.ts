/**
 * tile-binder.test.ts — unit tests for TileBinder.
 *
 * Uses fake HTMLElement (jsdom), fake TileSource, and fake bindHud.
 * Covers the four behaviors called out in the issue:
 *  1. Echo-suppression: host writes a value → binder does not re-emit
 *  2. Gesture freeze: gestureActive=true → applyData holds order
 *  3. gesturecommit re-apply on release (non-canceled)
 *  4. Reconcile-by-id when source cardinality changes (shape change → remount)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bindTile, near, vkey } from '../../src/host/tile-binder'
import type { TileSource } from '../../src/host/tile-binder'
import type { GesturePhase } from '@hotbook/bireactive'

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
    applyCalls: [] as Array<{ gestureActive: boolean; lastRef: Map<string, number> }>,
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
  it('passes phase: gesturing when element has gestureActive flag set', () => {
    const container = makeContainer()
    const source = makeFakeSource('s1')
    const ctrl = bindTile(container, source, noopBindHud)

    // Simulate the chart setting gestureActive on the element
    const el = container.querySelector('x-fake-chart') as any
    el.gestureActive = true

    ctrl.update(makeFakeSource('s1'))

    const calls = source.spy.applyCalls
    const updateCall = calls[calls.length - 1]!
    expect(updateCall.phase).toBe('gesturing')
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

describe('gesturecommit re-apply', () => {
  it('re-applies data after a non-canceled gesturecommit', async () => {
    const container = makeContainer()
    const source = makeFakeSource('s1')
    bindTile(container, source, noopBindHud)

    const el = container.querySelector('x-fake-chart')!
    // Ensure not gesture-active when the commit fires
    ;(el as any).gestureActive = false

    const beforeCount = source.spy.applyCalls.length

    // Fire gesturecommit with canceled:false (the "real commit" path)
    const event = new CustomEvent('gesturecommit', { detail: { canceled: false } })
    el.dispatchEvent(event)

    // The re-apply is deferred via queueMicrotask
    await new Promise(resolve => queueMicrotask(resolve))

    expect(source.spy.applyCalls.length).toBeGreaterThan(beforeCount)
    const lastCall = source.spy.applyCalls[source.spy.applyCalls.length - 1]!
    expect(lastCall.phase).toBe('settling')
  })

  it('does NOT re-apply after a canceled gesturecommit (Esc)', async () => {
    const container = makeContainer()
    const source = makeFakeSource('s1')
    bindTile(container, source, noopBindHud)

    const el = container.querySelector('x-fake-chart')!
    ;(el as any).gestureActive = false

    const beforeCount = source.spy.applyCalls.length

    // Fire gesturecommit with canceled:true (Esc-cancel path)
    const event = new CustomEvent('gesturecommit', { detail: { canceled: true } })
    el.dispatchEvent(event)

    await new Promise(resolve => queueMicrotask(resolve))

    // No additional applyData call
    expect(source.spy.applyCalls.length).toBe(beforeCount)
  })

  it('does NOT re-apply for bare gesturecommit (no detail) — legacy charts', async () => {
    const container = makeContainer()
    const source = makeFakeSource('s1')
    bindTile(container, source, noopBindHud)

    const el = container.querySelector('x-fake-chart')!
    ;(el as any).gestureActive = false

    const beforeCount = source.spy.applyCalls.length

    // Bare gesturecommit — no detail property
    el.dispatchEvent(new CustomEvent('gesturecommit'))

    await new Promise(resolve => queueMicrotask(resolve))

    expect(source.spy.applyCalls.length).toBe(beforeCount)
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
