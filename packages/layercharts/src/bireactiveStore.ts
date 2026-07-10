// bireactiveStore — adapt a bireactive Cell to Svelte's store contract.
//
// Why this exists: LayerChart (and any Svelte component) consumes data via
// Svelte stores ({ subscribe, set, update }). Bireactive owns the data model
// (writable Num cells, branch lenses, automatic aggregation). This bridge
// lets a Svelte component read/write bireactive cells transparently.
//
// Implementation: `effect(fn)` re-runs `fn` whenever any cell read in `fn`
// changes. That's exactly Svelte's store-subscribe contract.

import { effect, type Cell, type Writable } from "bireactive";

export interface ReadableStore<T> {
  subscribe: (run: (value: T) => void) => () => void;
}

export interface WritableStore<T> extends ReadableStore<T> {
  set: (value: T) => void;
  update: (updater: (value: T) => T) => void;
}

/**
 * Wrap a read-only bireactive cell as a Svelte readable store.
 * `read` is called every time the store should fire (typically `() => cell.value`).
 */
export function readableFromCell<T>(read: () => T): ReadableStore<T> {
  return {
    subscribe(run) {
      // effect() runs the inner fn once immediately, then re-runs on cell change.
      const dispose = effect(() => {
        const v = read();
        run(v);
      });
      return dispose;
    },
  };
}

/**
 * Wrap a writable bireactive cell (Writable<Num>, or any Cell with .value setter)
 * as a Svelte writable store. Writes go straight back into the cell — the cell's
 * lens (if any) handles the inverse propagation.
 */
export function writableFromCell<T extends { value: any }>(
  cell: Writable<T>,
): WritableStore<T["value"]> {
  return {
    subscribe(run) {
      const dispose = effect(() => {
        run(cell.value);
      });
      return dispose;
    },
    set(v) {
      cell.value = v;
    },
    update(fn) {
      cell.value = fn(cell.value);
    },
  };
}

/**
 * Most general: derive a Svelte store from an arbitrary reactive read.
 * Useful for projections (e.g. mapping a Vec cell to {x, y}).
 */
export function derivedStore<T>(read: () => T): ReadableStore<T> {
  return readableFromCell(read);
}

/**
 * Plain Cell<T> as a readable store. Cell has `.value`; effect tracks reads.
 */
export function cellStore<T>(cell: Cell<T>): ReadableStore<T> {
  return readableFromCell(() => cell.value);
}
