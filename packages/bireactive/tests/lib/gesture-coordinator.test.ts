import { describe, it, expect, beforeEach } from 'vitest'
import { gestureCoordinator, activeGestureController } from '../../src/lib/gesture-coordinator'

describe('GestureCoordinator', () => {
  beforeEach(() => {
    gestureCoordinator.setActive(null)
  })

  it('starts with no active controller', () => {
    expect(gestureCoordinator.active).toBeNull()
    expect(gestureCoordinator.isActive).toBe(false)
  })

  it('setActive() sets active + isActive', () => {
    const controller = {}
    gestureCoordinator.setActive(controller)
    expect(gestureCoordinator.active).toBe(controller)
    expect(gestureCoordinator.isActive).toBe(true)
  })

  it('setActive(null) clears active + isActive', () => {
    gestureCoordinator.setActive({})
    gestureCoordinator.setActive(null)
    expect(gestureCoordinator.active).toBeNull()
    expect(gestureCoordinator.isActive).toBe(false)
  })

  it('setActive() replaces the previous controller (last-writer-wins)', () => {
    const a = {}
    const b = {}
    gestureCoordinator.setActive(a)
    gestureCoordinator.setActive(b)
    expect(gestureCoordinator.active).toBe(b)
  })

  it('activeGestureController mirrors gestureCoordinator.active reactively', () => {
    const controller = {}
    expect(activeGestureController.value).toBeNull()
    gestureCoordinator.setActive(controller)
    expect(activeGestureController.value).toBe(controller)
  })
})
