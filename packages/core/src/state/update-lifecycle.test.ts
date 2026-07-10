import { describe, it, expect, vi } from 'vitest'
import { createUpdateLifecycleMachine, createIdleTrigger } from './update-lifecycle'

describe('UpdateLifecycleMachine', () => {
  it('starts in Idle state', () => {
    const machine = createUpdateLifecycleMachine()
    expect(machine.getState().key).toBe('Idle')
    expect(machine.isIdle()).toBe(true)
    expect(machine.isActive()).toBe(false)
  })

  it('transitions Idle -> Active on updatePending', () => {
    const machine = createUpdateLifecycleMachine()
    machine.updatePending()
    expect(machine.getState().key).toBe('Active')
    expect(machine.isActive()).toBe(true)
    expect(machine.isIdle()).toBe(false)
  })

  it('stays in Idle on updateNow', () => {
    const machine = createUpdateLifecycleMachine()
    machine.updateNow()
    expect(machine.getState().key).toBe('Idle')
  })

  it('transitions Active -> AwaitingIdle on updateDone', () => {
    const machine = createUpdateLifecycleMachine()
    machine.updatePending()
    machine.updateDone()
    expect(machine.getState().key).toBe('AwaitingIdle')
  })

  it('transitions AwaitingIdle -> Idle on idled', () => {
    const machine = createUpdateLifecycleMachine()
    machine.updatePending()
    machine.updateDone()
    machine.idled()
    expect(machine.getState().key).toBe('Idle')
  })

  it('handles interleaving case: new gesture during AwaitingIdle', () => {
    const machine = createUpdateLifecycleMachine()
    const onIdleCallback = vi.fn()
    machine.onEnterIdle?.(onIdleCallback)

    // First gesture
    machine.updatePending()
    expect(machine.getState().key).toBe('Active')
    machine.updateDone()
    expect(machine.getState().key).toBe('AwaitingIdle')

    // New gesture starts before idled fires
    machine.updatePending()
    expect(machine.getState().key).toBe('Active')

    // Idle callback should NOT have been called
    expect(onIdleCallback).not.toHaveBeenCalled()

    // Complete second gesture
    machine.updateDone()
    machine.idled()
    expect(machine.getState().key).toBe('Idle')
    expect(onIdleCallback).toHaveBeenCalledOnce()
  })

  it('stays in Active on updatePending', () => {
    const machine = createUpdateLifecycleMachine()
    machine.updatePending()
    machine.updatePending()
    expect(machine.getState().key).toBe('Active')
  })

  it('stays in Active on updateNow', () => {
    const machine = createUpdateLifecycleMachine()
    machine.updatePending()
    machine.updateNow()
    expect(machine.getState().key).toBe('Active')
  })

  it('stays in AwaitingIdle on updateNow', () => {
    const machine = createUpdateLifecycleMachine()
    machine.updatePending()
    machine.updateDone()
    machine.updateNow()
    expect(machine.getState().key).toBe('AwaitingIdle')
  })

  it('calls onEnterActive callback when entering Active', () => {
    const machine = createUpdateLifecycleMachine()
    const callback = vi.fn()
    machine.onEnterActive?.(callback)

    machine.updatePending()
    expect(callback).toHaveBeenCalledOnce()

    // Matchina calls enter on self-transitions, so this will trigger the callback
    machine.updatePending()
    expect(callback).toHaveBeenCalledTimes(2)

    // And when re-entering Active from another state
    machine.updateDone()
    machine.updatePending()
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('calls onEnterIdle callback when entering Idle', () => {
    const machine = createUpdateLifecycleMachine()
    const callback = vi.fn()
    machine.onEnterIdle?.(callback)

    machine.updatePending()
    machine.updateDone()
    machine.idled()
    expect(callback).toHaveBeenCalledOnce()

    // Matchina calls enter on self-transitions, so this will trigger the callback
    machine.updateNow()
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('removes callback when unsubscribe is called', () => {
    const machine = createUpdateLifecycleMachine()
    const callback = vi.fn()
    const unsubscribe = machine.onEnterActive?.(callback)

    machine.updatePending()
    expect(callback).toHaveBeenCalledOnce()

    unsubscribe?.()
    machine.updateDone()
    machine.updatePending()
    expect(callback).toHaveBeenCalledOnce() // Should not be called again
  })
})

describe('createIdleTrigger', () => {
  it('sends idled event after delay', async () => {
    const machine = createUpdateLifecycleMachine()
    const trigger = createIdleTrigger(machine, 50)

    machine.updatePending()
    machine.updateDone()
    trigger()

    expect(machine.getState().key).toBe('AwaitingIdle')

    await new Promise(resolve => setTimeout(resolve, 60))
    expect(machine.getState().key).toBe('Idle')
  })

  it('resets debounce on repeated calls', async () => {
    const machine = createUpdateLifecycleMachine()
    const trigger = createIdleTrigger(machine, 50)

    machine.updatePending()
    machine.updateDone()
    trigger()

    await new Promise(resolve => setTimeout(resolve, 30))
    trigger() // Reset debounce

    await new Promise(resolve => setTimeout(resolve, 30))
    expect(machine.getState().key).toBe('AwaitingIdle') // Should not be idle yet

    await new Promise(resolve => setTimeout(resolve, 30))
    expect(machine.getState().key).toBe('Idle') // Now should be idle
  })
})
