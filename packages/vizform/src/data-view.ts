import { cell, derive, type Read } from "bireactive";
import type { VizNode } from "@hotbook/core";
import { Editor, type GestureIntent } from "./editor.js";

export type SortMode = "index" | "value";
export type Orientation = "horizontal" | "vertical";

export interface IcicleConfig {
  measure: string;
  sort: SortMode;
  depth: number;
  orientation: Orientation;
  canReorder: boolean;
}

export type PatchFn = (nodes: readonly VizNode[]) => VizNode[];

/** DataView — per-chart query into a hierarchical Dataset.
 *
 * - Owns the canonical `committed` array and a speculative `draft` patch.
 * - `current` is `committed` with the draft patch applied, if any.
 * - `effectiveSort` is `index` while the Editor is Drafting, so sibling order
 *   freezes during a gesture; otherwise it follows `config.sort`.
 * - Config and focus changes are `updated` events.
 */
export class DataView {
  private _committed = cell<VizNode[]>([]);
  private _draft = cell<PatchFn | null>(null);
  private _config = cell<IcicleConfig>({
    measure: "value",
    sort: "index",
    depth: 100,
    orientation: "vertical",
    canReorder: false,
  });
  private _focus = cell<string | null>(null);

  readonly editor = new Editor();

  /** Reactive current view: committed data with the live draft patch applied. */
  readonly current: Read<VizNode[]> = derive(() => {
    const base = this._committed.value;
    const patch = this._draft.value;
    return patch ? patch(base) : base;
  });

  /** Effective sort while a gesture is live. */
  readonly effectiveSort: Read<SortMode> = derive(() =>
    this.editor.state.value === "Drafting" ? "index" : this._config.value.sort
  );

  readonly config: Read<IcicleConfig> = this._config;
  readonly focus: Read<string | null> = this._focus;

  constructor(nodes: readonly VizNode[] = []) {
    this._committed.value = nodes.slice();
  }

  setCommitted(nodes: readonly VizNode[]): void {
    this._committed.value = nodes.slice();
  }

  setDraft(intent: GestureIntent, patch: PatchFn, origin: unknown = null): void {
    if (this.editor.state.value === "Idle") {
      this.editor.start(intent, origin);
    } else {
      this.editor.draft();
    }
    this._draft.value = patch;
  }

  commit(): void {
    const patch = this._draft.value;
    if (patch) {
      this._committed.value = patch(this._committed.value);
    }
    this._draft.value = null;
    this.editor.commit();
  }

  cancel(): void {
    this._draft.value = null;
    this.editor.cancel();
  }

  /** External data change while the chart is mounted. */
  update(nodes: readonly VizNode[]): void {
    this._committed.value = nodes.slice();
    this.editor.updated();
  }

  updateConfig(patch: Partial<IcicleConfig>): void {
    this._config.value = { ...this._config.value, ...patch };
    this.editor.updated();
  }

  setFocus(id: string | null): void {
    this._focus.value = id;
    this.editor.updated();
  }
}
