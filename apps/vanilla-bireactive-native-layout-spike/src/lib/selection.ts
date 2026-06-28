// Shared selection state for the spike app.
//
// One reactive cell. Any spike can write to it (by clicking a shape),
// any UI can read from it (the sidebar in main.ts). Cleared when the
// selected id no longer exists in sharedRows / sharedEdges.

import { cell, type Cell, type Writable } from "@bireactive";

export type SelectedKind = "node" | "group" | "edge";

export interface Selection {
  kind: SelectedKind;
  id: string;
}

export const sharedSelection: Writable<Cell<Selection | null>> =
  cell<Selection | null>(null);

export function select(kind: SelectedKind, id: string): void {
  const cur = sharedSelection.value;
  if (cur && cur.kind === kind && cur.id === id) {
    sharedSelection.value = null;
  } else {
    sharedSelection.value = { kind, id };
  }
}

export function clearSelection(): void {
  sharedSelection.value = null;
}
