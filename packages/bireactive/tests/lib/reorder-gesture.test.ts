// Regression coverage for the Phase-1 threshold defect: reorder must not start
// the DataViewController at raw pointerdown. A press below the 5px activation
// threshold is a plain click — it must leave the machine Idle (no cross-tile
// freeze for the press duration, no Settling machine that nobody settles).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { attachReorderGesture } from '../../src/lib/reorder-gesture'
import { DataViewController } from '../../src/lib/data-view-controller'
import { gestureCoordinator } from '../../src/lib/gesture-coordinator'
import { dragController } from '../../src/lib/interaction'

function ptr(type: string, opts: { clientX?: number; clientY?: number; pointerId?: number } = {}): PointerEvent {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, {
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
    pointerId: opts.pointerId ?? 1,
    pointerType: 'mouse',
    button: 0,
  })
  return e as unknown as PointerEvent
}

function baseConfig(hitEl: HTMLElement, dv: DataViewController, onEnd: (order: readonly string[], canceled: boolean) => void) {
  return {
    hitEl,
    itemId: 'a',
    dataView: dv,
    intent: 'reorder' as const,
    origin: hitEl,
    getInitialOrder: () => ['a', 'b', 'c'],
    computeTargetIndex: () => 1,
    onPreview: () => {},
    onEnd,
  }
}

describe('attachReorderGesture — DataViewController lifecycle', () => {
  beforeEach(() => {
    dragController.cancel() // reset the shared singleton between tests
    gestureCoordinator.setActive(null)
  })

  it('a below-threshold click leaves the machine Idle and never fires onEnd', () => {
    const hitEl = document.createElement('div')
    document.body.appendChild(hitEl)
    const dv = new DataViewController()
    const onEnd = vi.fn()
    const detach = attachReorderGesture(baseConfig(hitEl, dv, onEnd))

    // pointerdown, a sub-5px move, then release — a plain click.
    hitEl.dispatchEvent(ptr('pointerdown', { clientX: 10, clientY: 10 }))
    window.dispatchEvent(ptr('pointermove', { clientX: 12, clientY: 11 })) // dx=2,dy=1 -> 5 < 25
    window.dispatchEvent(ptr('pointerup', { clientX: 12, clientY: 11 }))

    expect(dv.getState().key).toBe('Idle') // never started -> not stuck in Settling
    expect(gestureCoordinator.active).toBeNull() // siblings never frozen
    expect(onEnd).not.toHaveBeenCalled()

    detach()
  })

  it('crossing the threshold starts the machine and commits (Settling) before the chart onEnd', () => {
    const hitEl = document.createElement('div')
    document.body.appendChild(hitEl)
    const dv = new DataViewController()
    let stateAtOnEnd: string | null = null
    const onEnd = vi.fn(() => { stateAtOnEnd = dv.getState().key })
    const detach = attachReorderGesture(baseConfig(hitEl, dv, onEnd))

    hitEl.dispatchEvent(ptr('pointerdown', { clientX: 0, clientY: 0 }))
    window.dispatchEvent(ptr('pointermove', { clientX: 20, clientY: 0 })) // dx=20 -> activate
    expect(dv.getState().key).toBe('Gesturing')
    expect(gestureCoordinator.active).toBe(dv)

    window.dispatchEvent(ptr('pointerup', { clientX: 20, clientY: 0 }))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledWith(expect.any(Array), false)
    expect(stateAtOnEnd).toBe('Settling') // commit ran before the chart onEnd
    expect(gestureCoordinator.active).toBeNull() // frozen only while Gesturing

    detach()
  })

  it('Esc during an activated reorder cancels (Settling) before the chart onEnd', () => {
    const hitEl = document.createElement('div')
    document.body.appendChild(hitEl)
    const dv = new DataViewController()
    let canceledFlag: boolean | null = null
    const onEnd = vi.fn((_order: readonly string[], canceled: boolean) => { canceledFlag = canceled })
    const detach = attachReorderGesture(baseConfig(hitEl, dv, onEnd))

    hitEl.dispatchEvent(ptr('pointerdown', { clientX: 0, clientY: 0 }))
    window.dispatchEvent(ptr('pointermove', { clientX: 20, clientY: 0 }))
    expect(dv.getState().key).toBe('Gesturing')

    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    window.dispatchEvent(esc)

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(canceledFlag).toBe(true)
    expect(dv.getState().key).toBe('Settling')
    expect(gestureCoordinator.active).toBeNull()

    detach()
  })
})
