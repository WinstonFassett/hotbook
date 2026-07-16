import { cell, effect, type Read } from "bireactive";

export type GestureIntent = "edit" | "reorder";

export type EditorState = "Idle" | "Drafting";

export type EditorEvent = "start" | "draft" | "commit" | "cancel" | "updated";

export interface EditorSnapshot {
  state: EditorState;
  event: EditorEvent | null;
  intent: GestureIntent | null;
  origin: unknown;
}

/** Per-chart Editor state machine. Maps directly to the Editor contract in
 *  UBIQUITOUS_LANGUAGE.md: Idle -> Drafting -> Idle. Post-commit/cancel/updated
 *  transitions are owned by the chart (the `Editor` is `Idle` the moment `commit`
 *  or `cancel` fires).
 *
 * Built on bireactive public exports (`cell` + `effect`) — no matchina, no forked
 * bireactive. */
export class Editor {
  private _state = cell<EditorState>("Idle");
  private _event = cell<EditorEvent | null>(null);
  private _intent = cell<GestureIntent | null>(null);
  private _origin = cell<unknown>(null);

  /** Read-only reactive state. */
  readonly state: Read<EditorState> = this._state;
  /** Read-only reactive last event. */
  readonly event: Read<EditorEvent | null> = this._event;
  /** Read-only reactive intent. */
  readonly intent: Read<GestureIntent | null> = this._intent;
  /** Read-only reactive origin. */
  readonly origin: Read<unknown> = this._origin;

  start(intent: GestureIntent, origin: unknown): void {
    this._state.value = "Drafting";
    this._intent.value = intent;
    this._origin.value = origin;
    this._event.value = "start";
  }

  draft(): void {
    // Only change the event; state remains Drafting.
    this._event.value = "draft";
  }

  commit(): void {
    if (this._state.value !== "Drafting") return;
    this._state.value = "Idle";
    this._event.value = "commit";
    this._intent.value = null;
    this._origin.value = null;
  }

  cancel(): void {
    if (this._state.value !== "Drafting") return;
    this._state.value = "Idle";
    this._event.value = "cancel";
    this._intent.value = null;
    this._origin.value = null;
  }

  updated(): void {
    this._event.value = "updated";
  }

  getSnapshot(): EditorSnapshot {
    return {
      state: this._state.value,
      event: this._event.value,
      intent: this._intent.value,
      origin: this._origin.value,
    };
  }

  subscribe(fn: (snapshot: EditorSnapshot) => void): () => void {
    return effect(() => {
      // Touch all reactive fields so the effect re-runs on any change.
      const state = this._state.value;
      const event = this._event.value;
      const intent = this._intent.value;
      const origin = this._origin.value;
      fn({ state, event, intent, origin });
    });
  }
}
