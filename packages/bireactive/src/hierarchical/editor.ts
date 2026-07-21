// editor.ts — per-chart Editor state machine.
// Idle <-> Drafting. Events: draft, commit, cancel, updated.
// The Editor is agnostic to effects. The Chart attaches effects to transitions.

import type { DraftEvent, EditorStateKey, EditorTransition } from "./types";

export type EditorListener = (transition: EditorTransition) => void;

export class Editor {
  private _state: EditorStateKey = "Idle";
  private _listeners = new Set<EditorListener>();
  private _currentDraft: DraftEvent | null = null;

  get state(): EditorStateKey {
    return this._state;
  }

  get currentDraft(): DraftEvent | null {
    return this._currentDraft;
  }

  draft(event: DraftEvent): void {
    const from = this._state;
    this._state = "Drafting";
    this._currentDraft = event;
    this._emit({ from, to: "Drafting", type: "draft", draft: event });
  }

  updateDraft(event: DraftEvent): void {
    if (this._state !== "Drafting") return;
    this._currentDraft = event;
    this._emit({ from: "Drafting", to: "Drafting", type: "draft", draft: event });
  }

  commit(): void {
    if (this._state !== "Drafting") return;
    const from = this._state;
    const draft = this._currentDraft;
    this._state = "Idle";
    this._currentDraft = null;
    this._emit({ from, to: "Idle", type: "commit", draft: draft ?? undefined });
  }

  cancel(): void {
    if (this._state !== "Drafting") return;
    const from = this._state;
    const draft = this._currentDraft;
    this._state = "Idle";
    this._currentDraft = null;
    this._emit({ from, to: "Idle", type: "cancel", draft: draft ?? undefined });
  }

  updated(): void {
    // updated does not change Editor state.
    const from = this._state;
    this._emit({ from, to: from, type: "updated" });
  }

  subscribe(fn: EditorListener): () => void {
    this._listeners.add(fn);
    return () => {
      this._listeners.delete(fn);
    };
  }

  dispose(): void {
    this._listeners.clear();
    this._currentDraft = null;
    this._state = "Idle";
  }

  private _emit(t: EditorTransition): void {
    for (const fn of this._listeners) fn(t);
  }
}

/** Kernel.Drafts — tracks active editors, reports global Idle/Drafting.
 *  Pubsub: components subscribe. Kernel pushes nothing imperatively. */
export class Drafts {
  private _editors = new Set<Editor>();
  private _listeners = new Set<(isDrafting: boolean, activeEditor: Editor | null) => void>();

  register(editor: Editor): () => void {
    this._editors.add(editor);
    return () => {
      this._editors.delete(editor);
      this._check();
    };
  }

  /** Called by an editor when it starts drafting. */
  onDraftStart(editor: Editor): void {
    this._notify(true, editor);
  }

  /** Called by an editor when it commits or cancels. */
  onDraftEnd(editor: Editor): void {
    this._check();
  }

  get isDrafting(): boolean {
    for (const e of this._editors) {
      if (e.state === "Drafting") return true;
    }
    return false;
  }

  get activeEditor(): Editor | null {
    for (const e of this._editors) {
      if (e.state === "Drafting") return e;
    }
    return null;
  }

  subscribe(fn: (isDrafting: boolean, activeEditor: Editor | null) => void): () => void {
    this._listeners.add(fn);
    return () => {
      this._listeners.delete(fn);
    };
  }

  private _check(): void {
    const active = this.activeEditor;
    this._notify(active !== null, active);
  }

  private _notify(isDrafting: boolean, active: Editor | null): void {
    for (const fn of this._listeners) fn(isDrafting, active);
  }
}
