import { matchina, defineStates, setup, enter } from 'matchina'

export type UpdateLifecycleState = 'Idle' | 'Active' | 'AwaitingIdle'

export type UpdateLifecycleEvent =
  | 'updateNow'      // Final Commit/Cancel — immediate, skip view transitions
  | 'updatePending'  // Mid-gesture Start/Update — show immediately, may animate within gesture
  | 'updateDone'     // Batched updates settled
  | 'idled'          // Debounced idle fired (persistence/undo hooks go here)

export interface UpdateLifecycleMachine {
  getState: () => { key: UpdateLifecycleState }
  updateNow: () => void
  updatePending: () => void
  updateDone: () => void
  idled: () => void
  isActive: () => boolean
  isIdle: () => boolean
  shouldSkipTransition: () => boolean
  onEnterActive?: (callback: () => void) => () => void
  onEnterIdle?: (callback: () => void) => () => void
}

/**
 * Update-lifecycle state machine for gesture coordination.
 *
 * States:
 * - Idle: No active updates
 * - Active: Mid-gesture or batched updates in flight
 * - AwaitingIdle: Updates settled, waiting for debounced idle
 *
 * Events:
 * - updatePending: Mid-gesture Start/Update (show immediately, may animate within gesture)
 * - updateNow: Final Commit/Cancel (immediate, skip view transitions)
 * - updateDone: Batched updates settled
 * - idled: Debounced idle fired (persistence/undo hooks go here)
 *
 * Transitions:
 * Idle:
 *   updateNow => Idle (immediate update, stay idle)
 *   updatePending => Active (start gesture)
 *
 * Active:
 *   updateNow => Active (final action during gesture)
 *   updatePending => Active (continued gesture)
 *   updateDone => AwaitingIdle (gesture complete, waiting for idle)
 *
 * AwaitingIdle:
 *   updateNow => AwaitingIdle (immediate update)
 *   updatePending => Active (new gesture started, cancel idle wait)
 *   idled => Idle (debounce fired, ready for persistence/undo)
 */
export function createUpdateLifecycleMachine(): UpdateLifecycleMachine {
  const states = defineStates({
    Idle: undefined,
    Active: undefined,
    AwaitingIdle: undefined,
  })

  const machine = matchina(
    states,
    {
      Idle: {
        updateNow: 'Idle',
        updatePending: 'Active',
      },
      Active: {
        updateNow: 'Active',
        updatePending: 'Active',
        updateDone: 'AwaitingIdle',
      },
      AwaitingIdle: {
        updateNow: 'AwaitingIdle',
        updatePending: 'Active',
        idled: 'Idle',
      },
    },
    'Idle'
  )

  const activeCallbacks: Set<() => void> = new Set()
  const idleCallbacks: Set<() => void> = new Set()

  // Set up lifecycle hooks
  setup(machine)(
    enter((ev) => {
      if (ev.to.key === 'Active') {
        activeCallbacks.forEach(cb => cb())
      } else if (ev.to.key === 'Idle') {
        idleCallbacks.forEach(cb => cb())
      }
    })
  )

  return {
    getState: () => machine.getState(),
    updateNow: () => machine.updateNow(),
    updatePending: () => machine.updatePending(),
    updateDone: () => machine.updateDone(),
    idled: () => machine.idled(),
    isActive: () => machine.getState().key === 'Active',
    isIdle: () => machine.getState().key === 'Idle',
    shouldSkipTransition: () => {
      // Skip transitions for final actions (updateNow events)
      // This is a semantic hint for consumers
      return false // Actual skip logic is in consumer handling of updateNow events
    },
    onEnterActive: (callback: () => void) => {
      activeCallbacks.add(callback)
      return () => activeCallbacks.delete(callback)
    },
    onEnterIdle: (callback: () => void) => {
      idleCallbacks.add(callback)
      return () => idleCallbacks.delete(callback)
    },
  }
}

/**
 * Helper to create a debounced idle trigger for the state machine.
 * Call the returned function whenever an update occurs; it will
 * send 'idled' after the specified delay of inactivity.
 */
export function createIdleTrigger(
  machine: UpdateLifecycleMachine,
  delayMs: number = 500
): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      machine.idled()
      timeoutId = null
    }, delayMs)
  }
}
