/**
 * editor.ts — per-chart Editor state machine + global GestureCoordinator.
 *
 * Per ADR (docs/adr/gesture-state-machine.md):
 * - Editor has two states: Idle and Drafting.
 * - Events: draft, commit, cancel, updated.
 * - The chart attaches effects to Editor transitions.
 * - GestureCoordinator is the global singleton that tracks the active editor
 *   and freezes cross-tile order during live gestures.
 *
 * This replaces the GESTURE_ACTIVE_CLASS timer hack.
 */

// ─── Editor state machine ────────────────────────────────────────────────────

export type EditorStateKey = 'Idle' | 'Drafting';
export type EditorIntent = 'pre-edit' | 'reorder' | null;

export interface EditorState {
  key: EditorStateKey;
  intent: EditorIntent;
  origin: unknown | null;
}

export interface EditorTransition {
  from: EditorStateKey;
  to: EditorStateKey;
  type: 'draft' | 'updated' | 'commit' | 'cancel';
  intent: EditorIntent;
  origin: unknown;
}

export type EditorListener = (transition: EditorTransition) => void;

export class Editor {
  private _state: EditorState = { key: 'Idle', intent: null, origin: null };
  private _listeners = new Set<EditorListener>();

  getState(): EditorState {
    return this._state;
  }

  draft(intent: 'pre-edit' | 'reorder', origin: unknown): void {
    if (this._state.key === 'Idle') {
      this._transition('draft', 'Drafting', intent, origin);
    } else {
      // Already drafting — update intent/origin without state change.
      // This is a "draft while drafting" — the value changed.
      this._state = { key: 'Drafting', intent, origin };
      this._emit({ from: 'Drafting', to: 'Drafting', type: 'draft', intent, origin });
    }
  }

  updated(): void {
    // updated does not change Editor state.
    const { key, intent, origin } = this._state;
    this._emit({ from: key, to: key, type: 'updated', intent, origin });
  }

  commit(): void {
    if (this._state.key === 'Drafting') {
      this._transition('commit', 'Idle', null, null);
    }
  }

  cancel(): void {
    if (this._state.key === 'Drafting') {
      this._transition('cancel', 'Idle', null, null);
    }
  }

  subscribe(fn: EditorListener): () => void {
    this._listeners.add(fn);
    return () => { this._listeners.delete(fn); };
  }

  dispose(): void {
    this._listeners.clear();
    gestureCoordinator._unregister(this);
  }

  private _transition(
    type: EditorTransition['type'],
    to: EditorStateKey,
    intent: EditorIntent,
    origin: unknown,
  ): void {
    const from = this._state.key;
    this._state = { key: to, intent, origin };
    this._emit({ from, to, type, intent, origin });
  }

  private _emit(t: EditorTransition): void {
    for (const fn of this._listeners) fn(t);
  }
}

// ─── GestureCoordinator ──────────────────────────────────────────────────────

/**
 * Global singleton that tracks the active editor. When one chart is drafting,
 * other charts on the same data are frozen — they render the draft preview but
 * defer reorder/relayout until the active editor commits or cancels.
 *
 * This replaces the GESTURE_ACTIVE_CLASS CSS suppression hack. Instead of a
 * CSS class on the host element, the coordinator provides a reactive phase
 * that charts read to decide whether to tween or snap.
 */
class GestureCoordinatorImpl {
  /** The currently active editor, or null if none. */
  active: Editor | null = null;
  private _listeners = new Set<(active: Editor | null) => void>();

  /**
   * Register an editor as starting a gesture. If another editor is already
   * active, this is a no-op (only one gesture at a time).
   */
  begin(editor: Editor): void {
    if (this.active && this.active !== editor) return;
    this.active = editor;
    this._notify();
  }

  /**
   * Clear the active editor if it matches. Called on commit/cancel.
   */
  end(editor: Editor): void {
    if (this.active === editor) {
      this.active = null;
      this._notify();
    }
  }

  /** Is the given editor the active one? */
  isActive(editor: Editor): boolean {
    return this.active === editor;
  }

  /** Is any gesture active? */
  isGesturing(): boolean {
    return this.active !== null;
  }

  subscribe(fn: (active: Editor | null) => void): () => void {
    this._listeners.add(fn);
    return () => { this._listeners.delete(fn); };
  }

  /** Internal: called by Editor.dispose to clear if it's the active one. */
  _unregister(editor: Editor): void {
    this.end(editor);
  }

  private _notify(): void {
    for (const fn of this._listeners) fn(this.active);
  }
}

export const gestureCoordinator = new GestureCoordinatorImpl();

// ─── GesturePhase helper ─────────────────────────────────────────────────────

/**
 * Derive a GesturePhase from an Editor's state + the coordinator.
 * - 'idle': no gesture, normal rendering.
 * - 'gesturing': this editor is actively drafting — live preview, siblings frozen.
 * - 'frozen': another editor is drafting — render the draft but defer relayout.
 */
export type GesturePhase = 'idle' | 'gesturing' | 'frozen';

export function phaseOf(editor: Editor | null | undefined): GesturePhase {
  if (!editor) return 'idle';
  if (!gestureCoordinator.isGesturing()) return 'idle';
  return gestureCoordinator.isActive(editor) ? 'gesturing' : 'frozen';
}

// ─── DataViewController ──────────────────────────────────────────────────────

/**
 * Per-chart controller that owns the Editor and wires it to the coordinator.
 * Created by the chart in connectedCallback, disposed in disconnectedCallback.
 *
 * This is what tile-binder.ts and the charts import as `DataViewController`.
 * It wraps an Editor and provides the gesture lifecycle:
 *   start(intent, origin) → draft + coordinator.begin
 *   commit()              → editor.commit + coordinator.end
 *   cancel()              → editor.cancel + coordinator.end
 *   updated()             → editor.updated (external data change)
 */
export class DataViewController {
  readonly editor: Editor;

  constructor() {
    this.editor = new Editor();
  }

  get state(): EditorState {
    return this.editor.getState();
  }

  /** Begin a gesture. Sets the editor to Drafting and registers with the coordinator. */
  start(intent: 'pre-edit' | 'reorder', origin: unknown): void {
    this.editor.draft(intent, origin);
    gestureCoordinator.begin(this.editor);
  }

  /** Update the draft value (still Drafting). */
  draft(intent: 'pre-edit' | 'reorder', origin: unknown): void {
    this.editor.draft(intent, origin);
  }

  /** Commit the gesture. Returns to Idle, clears the coordinator. */
  commit(): void {
    this.editor.commit();
    gestureCoordinator.end(this.editor);
  }

  /** Cancel the gesture. Returns to Idle, clears the coordinator. */
  cancel(): void {
    this.editor.cancel();
    gestureCoordinator.end(this.editor);
  }

  /** External data changed while Idle (or Drafting — updated doesn't change state). */
  updated(): void {
    this.editor.updated();
  }

  subscribe(fn: EditorListener): () => void {
    return this.editor.subscribe(fn);
  }

  /** Get the gesture phase for this controller. */
  get phase(): GesturePhase {
    return phaseOf(this.editor);
  }

  dispose(): void {
    this.editor.dispose();
  }
}
