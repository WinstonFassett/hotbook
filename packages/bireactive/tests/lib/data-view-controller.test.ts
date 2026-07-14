import { describe, it, expect, beforeEach } from 'vitest'
import { DataViewController } from '../../src/lib/data-view-controller'
import { gestureCoordinator } from '../../src/lib/gesture-coordinator'

describe('DataViewController', () => {
  beforeEach(() => {
    gestureCoordinator.setActive(null)
  })

  it('starts Idle', () => {
    const dv = new DataViewController()
    const state = dv.getState()
    expect(state.key).toBe('Idle')
    expect(state.transitioning).toBe(false)
    expect(state.intent).toBeNull()
    expect(state.origin).toBeNull()
    expect(state.frozen.order).toBe(false)
  })

  it('start() moves to Gesturing with intent + origin', () => {
    const dv = new DataViewController()
    const origin = {}
    dv.start('edit', origin)
    const state = dv.getState()
    expect(state.key).toBe('Gesturing')
    expect(state.intent).toBe('edit')
    expect(state.origin).toBe(origin)
    expect(state.frozen.order).toBe(true)
    expect(state.transitioning).toBe(false)
  })

  it('commit() moves Gesturing -> Settling, preserving intent + origin', () => {
    const dv = new DataViewController()
    const origin = {}
    dv.start('reorder', origin)
    dv.commit()
    const state = dv.getState()
    expect(state.key).toBe('Settling')
    expect(state.transitioning).toBe(true)
    expect(state.intent).toBe('reorder')
    expect(state.origin).toBe(origin)
    expect(state.frozen.order).toBe(false)
  })

  it('cancel() moves Gesturing -> Settling, preserving intent + origin', () => {
    const dv = new DataViewController()
    const origin = {}
    dv.start('edit', origin)
    dv.cancel()
    const state = dv.getState()
    expect(state.key).toBe('Settling')
    expect(state.intent).toBe('edit')
    expect(state.origin).toBe(origin)
  })

  it('settle() moves Settling -> Idle, clearing intent + origin', () => {
    const dv = new DataViewController()
    dv.start('edit', {})
    dv.commit()
    dv.settle()
    const state = dv.getState()
    expect(state.key).toBe('Idle')
    expect(state.intent).toBeNull()
    expect(state.origin).toBeNull()
  })

  it('start() while Settling re-enters Gesturing (interrupt)', () => {
    const dv = new DataViewController()
    dv.start('edit', 'a')
    dv.commit()
    expect(dv.getState().key).toBe('Settling')
    dv.start('reorder', 'b')
    const state = dv.getState()
    expect(state.key).toBe('Gesturing')
    expect(state.intent).toBe('reorder')
    expect(state.origin).toBe('b')
  })

  it('commit()/cancel()/settle() are no-ops from the wrong state', () => {
    const dv = new DataViewController()
    dv.commit() // Idle: no-op
    expect(dv.getState().key).toBe('Idle')
    dv.cancel() // Idle: no-op
    expect(dv.getState().key).toBe('Idle')
    dv.settle() // Idle: no-op
    expect(dv.getState().key).toBe('Idle')

    dv.start('edit', {})
    dv.settle() // Gesturing: settle only valid from Settling -> no-op
    expect(dv.getState().key).toBe('Gesturing')
  })

  it('subscribe() notifies on every transition and unsubscribes cleanly', () => {
    const dv = new DataViewController()
    const seen: string[] = []
    const unsubscribe = dv.subscribe((state) => seen.push(state.key))
    dv.start('edit', {})
    dv.commit()
    dv.settle()
    expect(seen).toEqual(['Gesturing', 'Settling', 'Idle'])
    unsubscribe()
    dv.start('edit', {})
    expect(seen).toEqual(['Gesturing', 'Settling', 'Idle'])
  })

  it('start() registers itself as the active gesture coordinator controller', () => {
    const dv = new DataViewController()
    expect(gestureCoordinator.active).toBeNull()
    dv.start('edit', {})
    expect(gestureCoordinator.active).toBe(dv)
  })

  it('commit() clears the coordinator immediately — not deferred to settle()', () => {
    const dv = new DataViewController()
    dv.start('edit', {})
    expect(gestureCoordinator.active).toBe(dv)
    dv.commit()
    expect(gestureCoordinator.active).toBeNull()
    expect(dv.getState().key).toBe('Settling')
  })

  it('cancel() clears the coordinator immediately', () => {
    const dv = new DataViewController()
    dv.start('edit', {})
    dv.cancel()
    expect(gestureCoordinator.active).toBeNull()
  })

  it('does not clear another controller\'s active registration', () => {
    const dvA = new DataViewController()
    const dvB = new DataViewController()
    dvA.start('edit', {})
    expect(gestureCoordinator.active).toBe(dvA)
    // dvB never started a gesture, so it has nothing to clear.
    dvB.commit()
    expect(gestureCoordinator.active).toBe(dvA)
  })

  it('dispose() clears the coordinator if this controller is active', () => {
    const dv = new DataViewController()
    dv.start('edit', {})
    dv.dispose()
    expect(gestureCoordinator.active).toBeNull()
  })

  it('dispose() is a no-op if another controller is active', () => {
    const dvA = new DataViewController()
    const dvB = new DataViewController()
    dvA.start('edit', {})
    dvB.dispose()
    expect(gestureCoordinator.active).toBe(dvA)
  })
})
