// GestureSignal — shared infrastructure for any non-trivial gesture in the kit.
//
// Every gesture binding declares two independent properties:
//   - visual:    "real"  = the actual element follows the pointer
//                "ghost" = a translucent overlay follows; real stays put
//   - writeMode: "sync"   = cells write every frame
//                "commit" = cells write only on release (overrides hold the proposal)
//
// Ghost-commit is the classic "preview the proposal" mode: substrate unchanged
// until release; Esc cancels. The kit exposes both modes per behavior with a
// sensible default; bindings can override at the call site.
//
// This first cut intentionally stays small. It models a single in-flight gesture
// at a time (good enough for treemap drag-to-reparent), and uses plain TS state
// rather than bireactive cells — the Treemap component bridges to Svelte's
// $state directly. Once a second gesture surface needs the same infra we'll
// lift overrides into a `cell<Map<...>>` for cross-view subscribing.

import type { BiNode } from "./tree";

export type Visual = "real" | "ghost";
export type WriteMode = "sync" | "commit";

/**
 * A reparent proposal. `node` would move under `newParent` at position
 * `index` (0..newParent.children.length). For ghost-commit drag-to-reparent.
 */
export interface ReparentProposal {
  kind: "reparent";
  node: BiNode;
  newParent: BiNode;
  index: number;
}

export type Proposal = ReparentProposal;

/**
 * Snapshot of where a gesture began. Used for cancel (Esc) and undo.
 */
export interface GestureOrigin {
  pointer: { x: number; y: number };
  node: BiNode;
}

/**
 * Public surface a view binds to. The view reads `active`/`visual`/`proposal`
 * to render ghosts and drop targets; calls `begin`/`update`/`commit`/`cancel`
 * to drive the state machine.
 */
export interface GestureSignalState {
  active: boolean;
  visual: Visual;
  writeMode: WriteMode;
  proposal: Proposal | null;
  origin: GestureOrigin | null;
  pointer: { x: number; y: number } | null;
}

export const initialGestureState: GestureSignalState = {
  active: false,
  visual: "real",
  writeMode: "sync",
  proposal: null,
  origin: null,
  pointer: null,
};
