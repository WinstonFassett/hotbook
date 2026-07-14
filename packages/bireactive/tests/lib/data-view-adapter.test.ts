import { describe, it, expect, beforeEach } from 'vitest'
import { DataViewController } from '../../src/lib/data-view-controller'
import { gestureCoordinator } from '../../src/lib/gesture-coordinator'
import { createDataViewCell, globalGestureActive } from '../../src/lib/data-view-adapter'
import { GESTURE_ACTIVE_CLASS } from '../../src/lib/transitions'
import { settle as flush } from 'bireactive'

describe('data-view-adapter', () => {
  beforeEach(() => {
    gestureCoordinator.setActive(null)
  })

  it('createDataViewCell() mirrors DataViewController state', () => {
    const dv = new DataViewController()
    const handle = createDataViewCell(dv)
    expect(handle.cell.value.key).toBe('Idle')
    dv.start('edit', {})
    expect(handle.cell.value.key).toBe('Gesturing')
    handle.dispose()
  })

  it('toggles GESTURE_ACTIVE_CLASS on origin while Gesturing', () => {
    const dv = new DataViewController()
    const origin = document.createElement('div')
    const handle = createDataViewCell(dv)
    flush()
    expect(origin.classList.contains(GESTURE_ACTIVE_CLASS)).toBe(false)

    dv.start('edit', origin)
    flush()
    expect(origin.classList.contains(GESTURE_ACTIVE_CLASS)).toBe(true)

    dv.commit()
    flush()
    expect(origin.classList.contains(GESTURE_ACTIVE_CLASS)).toBe(false)

    handle.dispose()
  })

  it('dispose() removes the class and stops mirroring state', () => {
    const dv = new DataViewController()
    const origin = document.createElement('div')
    const handle = createDataViewCell(dv)
    dv.start('edit', origin)
    flush()
    expect(origin.classList.contains(GESTURE_ACTIVE_CLASS)).toBe(true)

    handle.dispose()
    flush()
    expect(origin.classList.contains(GESTURE_ACTIVE_CLASS)).toBe(false)

    dv.commit()
    flush()
    // No longer mirrored after dispose.
    expect(handle.cell.value.key).toBe('Gesturing')
  })

  it('globalGestureActive reflects whether ANY controller is Gesturing', () => {
    const dvA = new DataViewController()
    const dvB = new DataViewController()
    expect(globalGestureActive.value).toBe(false)

    dvA.start('edit', {})
    expect(globalGestureActive.value).toBe(true)

    dvA.commit()
    expect(globalGestureActive.value).toBe(false)

    dvB.start('reorder', {})
    expect(globalGestureActive.value).toBe(true)
    dvB.cancel()
    expect(globalGestureActive.value).toBe(false)
  })
})
