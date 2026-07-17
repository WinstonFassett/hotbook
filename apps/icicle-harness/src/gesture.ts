// gesture.ts — Gesture wraps an Editor + a per-gesture store.
// The Editor is the state machine (Idle/Drafting, draft/commit/cancel/updated).
// The Gesture adds a store for behaviors to share and a setup composition API.
//
// Chart state (config, focus, hover, tree) is stored as bireactive cells —
// they participate in the reactive graph, so derive()s and effect()s that read
// them automatically re-run when state changes. This is more powerful than
// standalone atoms because the rendering system already understands cells.
//
// The setup composition API is adapted from Matchina's setup pattern.

import { cell, type Cell, type Writable } from "bireactive";
import { Editor } from "./editor";
import type { DraftEvent, ChartConfig } from "./types";
import type { ChartNode } from "./hierarchy";

/** A value or a getter that resolves to a value. */
export type Resolvable<T> = T | (() => T);

/** Resolve a Resolvable at call time. */
export function resolve<T>(r: Resolvable<T>): T {
  return typeof r === "function" ? (r as () => T)() : r;
}

/** A getter that receives the gesture — so it can inspect store, config, held keys. */
export type GestureGetter<T> = (gesture: Gesture) => T;

/** Per-gesture store. Behaviors share state through this. */
export interface GestureStore {
  // --- Living chart state (bireactive cells) ---
  config: Writable<Cell<ChartConfig>>;
  focus: Writable<Cell<string | null>>;
  hover: Writable<Cell<string | null>>;
  tree: Writable<Cell<ChartNode | null>>;
  host: HTMLElement | null;

  // --- Transient gesture state (plain fields, reset on commit/cancel) ---
  snapshot: Map<string, number> | null;
  frozenOrder: Map<string, string[]> | null;
  pairTotal: number;
  activeEdge: { leftId: string; rightId: string } | null;
  activeTarget: string | null;
  heldKeys: Set<string>;
  keyGestureActive: boolean;
  keySnapshot: Map<string, number> | null;
  /** Whether Alt/Option is currently held (live modifier state for behaviors). */
  altHeld: boolean;

  extra: Map<string, unknown>;

  /** Optional snapshot function provided by the chart — called by behaviors
   *  before the first value write so cancel can revert. */
  takeSnapshot?: () => void;
}

export type Behavior = (gesture: Gesture) => () => void;

export class Gesture {
  readonly editor: Editor;
  readonly store: GestureStore;

  private _disposers: (() => void)[] = [];
  private _escHandler: (e: KeyboardEvent) => void;

  constructor(editor?: Editor, config?: ChartConfig) {
    this.editor = editor ?? new Editor();
    this.store = {
      config: cell(config ?? ({} as ChartConfig)),
      focus: cell<string | null>(null),
      hover: cell<string | null>(null),
      tree: cell<ChartNode | null>(null),
      host: null,
      snapshot: null,
      frozenOrder: null,
      pairTotal: 0,
      activeEdge: null,
      activeTarget: null,
      heldKeys: new Set(),
      keyGestureActive: false,
      keySnapshot: null,
      altHeld: false,
      extra: new Map(),
      takeSnapshot: undefined,
    };

    // Global Escape → cancel. One listener per Gesture. Behaviors don't
    // need to know about Escape — they just stop when the Editor goes Idle.
    // Also tracks Alt/Option state live for behaviors that flip on it.
    this._escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.state === "Drafting") {
        this.cancel();
      }
      this.store.altHeld = e.altKey;
    };
    document.addEventListener("keydown", this._escHandler);
    document.addEventListener("keyup", this._escHandler);
  }

  get state(): "Idle" | "Drafting" {
    return this.editor.state;
  }

  draft(event: DraftEvent): void {
    this.editor.draft(event);
  }

  updateDraft(event: DraftEvent): void {
    this.editor.updateDraft(event);
  }

  commit(): void {
    this.editor.commit();
  }

  cancel(): void {
    this.editor.cancel();
  }

  resetStore(): void {
    this.store.snapshot = null;
    this.store.frozenOrder = null;
    this.store.pairTotal = 0;
    this.store.activeEdge = null;
    this.store.activeTarget = null;
    this.store.heldKeys.clear();
    this.store.keyGestureActive = false;
    this.store.keySnapshot = null;
    this.store.extra.clear();
  }

  dispose(): void {
    this._disposers.forEach((d) => d());
    this._disposers = [];
    document.removeEventListener("keydown", this._escHandler);
    this.resetStore();
  }
}

export function setup(gesture: Gesture): (...behaviors: Behavior[]) => () => void {
  return (...behaviors: Behavior[]) => {
    gesture._disposers = behaviors.map((b) => b(gesture));
    return () => gesture.dispose();
  };
}
