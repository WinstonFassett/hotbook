// GanttChart — bireactive Gantt with BIDIRECTIONAL constraint solving.
//
// Schema (per task):
//   { id, label, start: Date, end: Date, color?,
//     deps?: Array<string | {from: string, lag?: number}> }
//
// Bidirectional Constraints:
//   - Drag right → push successors forward
//   - Drag left → push predecessors backward
//   - Lag support: positive = gap, negative = lead/overlap
//   - Space conservation: tasks return to origin when drag reverses
//
// Interactions:
//   - hover/select a task (click)
//   - Tab / Shift+Tab to navigate tasks
//   - drag bar body          → shift both start & end + bidirectional push
//   - drag left  handle      → move start only
//   - drag right handle      → move end only
//   - ←/→ on selected task   → nudge by 1 day (shift = 7 days)
//   - Escape reverts all tasks to snapshot
//
// Connectors: every `deps[]` entry draws an orthogonal finish-to-start
// arrow from the predecessor's end-edge into the dependent's start-edge.
//
// Bireactive: all reactive state lives in cells; the scene re-derives from
// `dataCell`, so external edits or in-chart drags reflow without React.

import {
  Anchor, cell, circle, derive, effect as biEffect,
  ensureArrowMarker,
  label, line, type Mount, pathD, rect, Vec,
  num, tween, easeOut, untracked,
} from "bireactive";
import { Diagram } from "../lib/diagram";
import { scaleTime } from "d3-scale";
import { makeBridge, type ElementWithBridge } from "../lib/hud-bridge";
import { useHostSize, FILL_STYLE, type HostSize } from "../lib/host-size";
import {
  dragController,
  dynamicWheelStep,
  wheelController,
  realModifierDown,
} from "../lib/interaction";
import {
  GESTURE_ACTIVE_CLASS,
  GESTURE_SUPPRESSION_CSS,
  REORDER_ELEVATION_CSS,
  hoverTransition,
} from "../lib/transitions";
import { lightenHex } from "../lib/color-utils";
import { PALETTE } from "@hotbook/core";
import { attachReorderGesture } from "../lib/reorder-gesture";

const W = 720;
const H = 360;
const DAY_MS = 86400 * 1000;

// Fixed row sizing for idiomatic Gantt layout
const ROW_H = 32;      // Row height
const ROW_GAP = 8;     // Gap between rows
const ROW_STEP = ROW_H + ROW_GAP; // Total step per row
const SORT_SEC = 0.35; // Sort/reorder tween duration in seconds

export interface GanttDependency {
  from: string;  // predecessor task ID
  lag?: number;  // gap in days (positive = wait, negative = overlap/lead). Default: 0
}

export interface GanttTask {
  id: string;
  label: string;
  start: Date;
  end: Date;
  color?: string;
  /** Dependencies with optional lag. Finish-to-start relationships.
   *  Can be string[] for backward compatibility or GanttDependency[] for lag support. */
  deps?: Array<string | GanttDependency>;
}

// Helper functions for working with flexible dependency format
function getDepId(dep: string | GanttDependency): string {
  return typeof dep === 'string' ? dep : dep.from;
}

function getDepLag(dep: string | GanttDependency): number {
  return typeof dep === 'string' ? 0 : (dep.lag ?? 0);
}

function makeSample(): GanttTask[] {
  const start = new Date(2026, 0, 1).getTime();
  return [
    { id: 't1', label: 'Discovery',   start: new Date(start + 0  * DAY_MS), end: new Date(start + 7  * DAY_MS) },
    { id: 't2', label: 'Design',      start: new Date(start + 5  * DAY_MS), end: new Date(start + 14 * DAY_MS), deps: ['t1'] },
    { id: 't3', label: 'Build core',  start: new Date(start + 12 * DAY_MS), end: new Date(start + 28 * DAY_MS), deps: ['t2'] },
    { id: 't4', label: 'QA',          start: new Date(start + 25 * DAY_MS), end: new Date(start + 34 * DAY_MS), deps: ['t3'] },
    { id: 't5', label: 'Launch',      start: new Date(start + 33 * DAY_MS), end: new Date(start + 36 * DAY_MS), deps: ['t3', 't4'] },
  ];
}

type DragKind = 'move' | 'start' | 'end';

export class MdGanttChartLC extends Diagram {
  static styles = `text { pointer-events: none; }${FILL_STYLE}${GESTURE_SUPPRESSION_CSS}${REORDER_ELEVATION_CSS}`;

  readonly dataCell = cell<readonly GanttTask[]>(makeSample());

  /** Pad domain by this many days on each side of the data extent. */
  domainPadDays = 2;

  /** When true, mutating a task pushes/pulls dependents so each successor's
   *  start meets the latest predecessor's end (zero slack). Propagation is
   *  forward-only in topological order; cycles are skipped silently. */
  enforceDeps = false;

  private _sortByCell = cell<'index' | 'value'>('index')
  get sortBy(): 'index' | 'value' { return this._sortByCell.value }
  set sortBy(v: 'index' | 'value') { this._sortByCell.value = v }

  /** Drag-to-reorder (WIN-287). When true and sortBy='index', dragging a row
   *  up/down reorders tasks. Caller handles data persistence via onReorder. */
  private _canReorderCell = cell<boolean>(false)
  get canReorder(): boolean { return this._canReorderCell.value }
  set canReorder(v: boolean) { this._canReorderCell.value = v }

  /** Fired when a drag-to-reorder commits. Receives the new task id sequence.
   *  Chart previews the reorder but doesn't persist; caller mutates data. */
  onReorder?: (orderedIds: string[]) => void

  /** Incremented when a user-driven reorder commits. Triggers y-cell tweens. */
  private _reorderTickCell = cell(0)

  set externalData(v: GanttTask[] | undefined) {
    if (v) this.dataCell.value = v;
  }
  get externalData(): GanttTask[] | undefined {
    return this.dataCell.value as GanttTask[];
  }

  protected scene(s: Mount): void {
    const size = useHostSize(this, { width: W, height: H });
    this.tabIndex = 0;
    this.style.outline = "none";
    // Rule 14: touch is a first-class gesture surface. Claim the touch gesture
    // from the browser so drag-edit on Gantt bars doesn't lose to page scroll.
    this.style.touchAction = "none";
    this.#draw(s, size);
  }

  #color(idx: number, task: GanttTask): string {
    return task.color ?? PALETTE[idx % PALETTE.length]!;
  }

  #draw(s: Mount, { w: Wc, h: Hc }: HostSize) {
    const PAD = { top: 20, right: 24, bottom: 36, left: 120 };
    const plotX = PAD.left, plotY = PAD.top;

    const data = this.dataCell;
    const rows0 = data.value as GanttTask[];

    this.view(Wc, Hc);

    // Sorted order: derive task array in display order based on sortBy.
    // When sortBy = 'value', sort by duration (end - start).
    // When sortBy = 'index', use natural data order.
    const sortedData = derive(() => {
      const tasks = [...(data.value as GanttTask[])];
      const sortBy = this._sortByCell.value;
      if (sortBy === 'value') {
        // Sort by task duration descending
        tasks.sort((a, b) => {
          const durA = a.end.getTime() - a.start.getTime();
          const durB = b.end.getTime() - b.start.getTime();
          return durB - durA; // Descending: longest first
        });
      }
      return tasks;
    });

    const plotW = derive(() => Math.max(0, Wc.value - PAD.left - PAD.right));
    const plotH = derive(() => Math.max(0, Hc.value - PAD.top - PAD.bottom));

    // x-scale: time domain spans data extent ± domainPadDays.
    const xScale = derive(() => {
      const rows = data.value as GanttTask[];
      let lo = rows[0]?.start.getTime() ?? Date.now();
      let hi = rows[0]?.end.getTime() ?? lo + DAY_MS;
      for (const t of rows) {
        if (t.start.getTime() < lo) lo = t.start.getTime();
        if (t.end.getTime()   > hi) hi = t.end.getTime();
      }
      const pad = this.domainPadDays * DAY_MS;
      return scaleTime()
        .domain([new Date(lo - pad), new Date(hi + pad)])
        .range([plotX, plotX + plotW.value]);
    });

    // Create per-task tweened y-position cells.
    // Map from task ID to {yCell, cancelFn}.
    const taskYCells = new Map<string, { yCell: ReturnType<typeof num>, yCenter: ReturnType<typeof derive>, cancel: (() => void) | null }>();
    for (const task of rows0) {
      const yCell = num(plotY); // Will be initialized below
      const yCenter = derive(() => yCell.value + ROW_H / 2);
      taskYCells.set(task.id, { yCell, yCenter, cancel: null });
    }

    // Helper to get target y position for a task ID in the current sorted order.
    const getTargetY = (taskId: string): number => {
      const sorted = sortedData.value;
      const idx = sorted.findIndex(t => t.id === taskId);
      return idx === -1 ? plotY : plotY + (idx * ROW_STEP);
    };

    // Initialize and react to sort/reorder changes: tween each task's y position to its new row.
    let sortInited = false;
    let lastSortBy = untracked(() => this._sortByCell.value);
    let lastReorderTick = untracked(() => this._reorderTickCell.value);
    biEffect(() => {
      const sorted = sortedData.value; // track sorted order
      const sortBy = this._sortByCell.value; // track sort key
      const reorderTick = this._reorderTickCell.value; // track reorder commits

      if (!sortInited) {
        // Initial placement: snap to positions
        for (const task of rows0) {
          const entry = taskYCells.get(task.id);
          if (entry) entry.yCell.value = getTargetY(task.id);
        }
        sortInited = true;
        lastSortBy = sortBy;
        lastReorderTick = reorderTick;
        return;
      }

      // Tween on sort change OR committed reorder (but not during active gesture)
      const sortChanged = sortBy !== lastSortBy;
      const reorderCommitted = reorderTick !== lastReorderTick;
      lastSortBy = sortBy;
      lastReorderTick = reorderTick;

      if ((sortChanged || reorderCommitted) && !this.classList.contains(GESTURE_ACTIVE_CLASS)) {
        for (const task of rows0) {
          const entry = taskYCells.get(task.id);
          if (!entry) continue;
          const targetY = getTargetY(task.id);
          entry.cancel?.();
          entry.cancel = this.anim.start(tween(entry.yCell, targetY, SORT_SEC, easeOut));
        }
      } else if (!sortChanged && !reorderCommitted) {
        // Data or size changed but sort/reorder didn't: snap to new positions
        for (const task of rows0) {
          const entry = taskYCells.get(task.id);
          if (entry) {
            entry.cancel?.();
            entry.cancel = null;
            entry.yCell.value = getTargetY(task.id);
          }
        }
      }
    });

    // Row positioning now uses sortedData for index lookups
    const rowY = (index: number) => plotY + (index * ROW_STEP);
    const rowCenterY = (index: number) => rowY(index) + ROW_H / 2;

    const hover = cell<GanttTask | null>(null);
    const selected = cell<GanttTask | null>(null);

    const svgEl = (this as any).svg as SVGSVGElement;
    svgEl.style.touchAction = "none";
    const localPoint = (e: PointerEvent) => {
      const r = svgEl.getBoundingClientRect();
      const vb = svgEl.viewBox?.baseVal;
      const sx = vb && vb.width ? vb.width / r.width : 1;
      const sy = vb && vb.height ? vb.height / r.height : 1;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    };
    const findAtPixelY = (py: number): GanttTask | null => {
      const rows = sortedData.value; // Use sorted order for hit testing
      for (let i = 0; i < rows.length; i++) {
        const entry = taskYCells.get(rows[i]!.id);
        if (!entry) continue;
        const by = entry.yCell.value;
        if (py >= by && py < by + ROW_STEP) return rows[i]!;
      }
      return null;
    };

    const setGestureActive = (on: boolean) => this.classList.toggle(GESTURE_ACTIVE_CLASS, on);
    const commit = () => this.dispatchEvent(new CustomEvent("gesturecommit"));

    // Mutate one task; keep ms granularity but snap to whole days.
    const snapDay = (ms: number) => Math.round(ms / DAY_MS) * DAY_MS;

    // BIDIRECTIONAL constraint propagation with lag support.
    // Pushes successors forward AND predecessors backward based on drag direction.
    // The `anchor` task (being dragged) is never moved by propagation.
    const propagateDeps = (anchor?: GanttTask, origins?: Map<string, {start: number; end: number}>) => {
      if (!this.enforceDeps) return;
      const rows = data.value as GanttTask[];
      const byId = new Map(rows.map(t => [t.id, t]));

      // Build graph structures
      const successors = new Map<string, GanttTask[]>();
      const predecessors = new Map<string, GanttTask[]>();

      for (const t of rows) {
        for (const dep of t.deps ?? []) {
          const predId = getDepId(dep);
          if (!byId.has(predId)) continue;

          const pred = byId.get(predId)!;
          const arr = successors.get(predId) ?? [];
          arr.push(t);
          successors.set(predId, arr);

          const predArr = predecessors.get(t.id) ?? [];
          predArr.push(pred);
          predecessors.set(t.id, predArr);
        }
      }

      // Determine drag direction if we have an anchor and origins
      let direction: 'forward' | 'backward' | 'both' = 'both';
      if (anchor && origins) {
        const origin = origins.get(anchor.id);
        if (origin) {
          const delta = anchor.start.getTime() - origin.start;
          const THRESHOLD = 0.5 * DAY_MS;
          if (delta > THRESHOLD) direction = 'forward';
          else if (delta < -THRESHOLD) direction = 'backward';
        }
      }

      const anchorId = anchor?.id;

      // Forward propagation: push successors right
      if (direction === 'forward' || direction === 'both') {
        const topo = topologicalSort(rows);
        for (const id of topo) {
          if (id === anchorId) continue;
          const task = byId.get(id)!;

          let minStart = -Infinity;
          for (const dep of task.deps ?? []) {
            const predId = getDepId(dep);
            const lag = getDepLag(dep);
            const pred = byId.get(predId);
            if (!pred) continue;

            const constraint = pred.end.getTime() + lag * DAY_MS;
            minStart = Math.max(minStart, constraint);
          }

          if (minStart > task.start.getTime()) {
            const duration = task.end.getTime() - task.start.getTime();
            task.start = new Date(minStart);
            task.end = new Date(minStart + duration);
          }
        }
      }

      // Backward propagation: push predecessors left
      if (direction === 'backward' || direction === 'both') {
        const topo = topologicalSort(rows).reverse();
        for (const id of topo) {
          if (id === anchorId) continue;
          const task = byId.get(id)!;

          // For each predecessor, check if it needs to move backward
          const preds = predecessors.get(id) ?? [];
          for (const pred of preds) {
            if (pred.id === anchorId) continue;

            // Find the dependency edge to get the lag
            const dep = task.deps?.find(d => getDepId(d) === pred.id);
            const lag = dep ? getDepLag(dep) : 0;

            // Calculate maximum end for predecessor based on successor's start
            const maxEnd = task.start.getTime() - lag * DAY_MS;

            if (pred.end.getTime() > maxEnd) {
              const duration = pred.end.getTime() - pred.start.getTime();
              pred.end = new Date(maxEnd);
              pred.start = new Date(maxEnd - duration);
            }
          }
        }

        // After pushing predecessors, enforce anchor's predecessor constraints
        // If predecessors can't move left anymore, anchor can't move past them
        if (anchor) {
          let minStart = -Infinity;
          for (const dep of anchor.deps ?? []) {
            const predId = getDepId(dep);
            const lag = getDepLag(dep);
            const pred = byId.get(predId);
            if (!pred) continue;

            const constraint = pred.end.getTime() + lag * DAY_MS;
            minStart = Math.max(minStart, constraint);
          }

          if (minStart > anchor.start.getTime()) {
            const duration = anchor.end.getTime() - anchor.start.getTime();
            anchor.start = new Date(minStart);
            anchor.end = new Date(minStart + duration);
          }
        }
      }

      // Space conservation: try to return tasks toward origin if no constraints prevent it
      if (origins && direction !== 'forward') {
        const topo = topologicalSort(rows);
        for (const id of topo) {
          if (id === anchorId) continue;
          const task = byId.get(id)!;
          const origin = origins.get(id);
          if (!origin) continue;

          const currentStart = task.start.getTime();
          const originStart = origin.start;

          // Only try to move back if task is ahead of origin
          if (currentStart <= originStart) continue;

          // Calculate safe backward position without violating constraints
          let safeStart = -Infinity;

          // Check predecessor constraints
          for (const dep of task.deps ?? []) {
            const predId = getDepId(dep);
            const lag = getDepLag(dep);
            const pred = byId.get(predId);
            if (!pred) continue;
            safeStart = Math.max(safeStart, pred.end.getTime() + lag * DAY_MS);
          }

          // Check successor constraints
          for (const succ of successors.get(id) ?? []) {
            const dep = succ.deps?.find(d => getDepId(d) === id);
            const lag = dep ? getDepLag(dep) : 0;
            const maxEnd = succ.start.getTime() - lag * DAY_MS;
            const duration = task.end.getTime() - task.start.getTime();
            safeStart = Math.max(safeStart, maxEnd - duration);
          }

          // Move back toward origin as far as safe
          const targetStart = Math.max(safeStart, originStart);
          if (targetStart < currentStart) {
            const duration = task.end.getTime() - task.start.getTime();
            task.start = new Date(targetStart);
            task.end = new Date(targetStart + duration);
          }
        }
      }
    };

    // Topological sort helper for Kahn's algorithm
    function topologicalSort(tasks: GanttTask[]): string[] {
      const byId = new Map(tasks.map(t => [t.id, t]));
      const indeg = new Map<string, number>();

      for (const t of tasks) indeg.set(t.id, 0);
      for (const t of tasks) {
        for (const dep of t.deps ?? []) {
          const predId = getDepId(dep);
          if (byId.has(predId)) {
            indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
          }
        }
      }

      const queue: string[] = [];
      for (const t of tasks) {
        if ((indeg.get(t.id) ?? 0) === 0) queue.push(t.id);
      }

      const result: string[] = [];
      while (queue.length) {
        const id = queue.shift()!;
        result.push(id);

        // Find successors
        for (const other of tasks) {
          for (const dep of other.deps ?? []) {
            const predId = getDepId(dep);
            if (predId === id) {
              const remaining = (indeg.get(other.id) ?? 1) - 1;
              indeg.set(other.id, remaining);
              if (remaining === 0) queue.push(other.id);
            }
          }
        }
      }

      return result;
    }
    const setRange = (t: GanttTask, startMs: number, endMs: number, skipPropagation = false) => {
      // Enforce min duration 1 day, keep start ≤ end.
      const min = DAY_MS;
      let s0 = snapDay(startMs);
      let s1 = snapDay(endMs);
      if (s1 - s0 < min) s1 = s0 + min;
      t.start = new Date(s0);
      t.end = new Date(s1);
      if (!skipPropagation) propagateDeps(t);
      data.value = [...data.value];
    };
    const nudge = (t: GanttTask, days: number) => {
      const delta = days * DAY_MS;
      setRange(t, t.start.getTime() + delta, t.end.getTime() + delta);
    };
    const resize = (t: GanttTask, days: number) => {
      const delta = days * DAY_MS;
      setRange(t, t.start.getTime(), t.end.getTime() + delta);
    };

    // Initialize: enforce deps on the initial data if enforceDeps is true.
    if (this.enforceDeps) {
      propagateDeps();
      data.value = [...data.value];
    }

    // ─── Pointer drag (body / start / end) ─────────────────────────────────
    //
    // BIDIRECTIONAL DRAG: Snapshots ALL task positions for space conservation.
    // During drag, applies real-time bidirectional constraint solving.
    // On Escape, restores ALL tasks to snapshot positions.
    // The controller owns move/up/cancel/Esc/blur listeners for the lifetime of the gesture.
    let dragPointerId = -1;

    const xToMs = (px: number): number => (xScale.value as any).invert(px).getTime();

    interface DragSnap {
      start: number;
      end: number;
      originMs: number;
      kind: DragKind;
      allPositions: Map<string, {start: number; end: number}>;  // Snapshot ALL tasks
    }

    const dragConfig = (kind: DragKind, originMs: number) => ({
      snapshot: (t: GanttTask): DragSnap => {
        setGestureActive(true);

        // Snapshot ALL task positions for bidirectional solving and space conservation
        const allPositions = new Map<string, {start: number; end: number}>();
        const rows = data.value as GanttTask[];
        for (const task of rows) {
          allPositions.set(task.id, {
            start: task.start.getTime(),
            end: task.end.getTime()
          });
        }

        return { start: t.start.getTime(), end: t.end.getTime(), originMs, kind, allPositions };
      },

      restore: (_t: GanttTask, snap: DragSnap) => {
        // Restore ALL tasks to snapshot positions (not just the dragged one)
        const rows = data.value as GanttTask[];
        for (const task of rows) {
          const pos = snap.allPositions.get(task.id);
          if (pos) {
            task.start = new Date(pos.start);
            task.end = new Date(pos.end);
          }
        }
        data.value = [...data.value];
      },

      onMove: (pe: PointerEvent, snap: DragSnap) => {
        const t = dragController.target as GanttTask | null;
        if (!t) return;
        const dms = xToMs(localPoint(pe).x) - snap.originMs;

        // Apply drag to target task
        if (snap.kind === 'move') {
          const dur = snap.end - snap.start;
          const newStart = snapDay(snap.start + dms);
          t.start = new Date(newStart);
          t.end = new Date(newStart + dur);
        } else if (snap.kind === 'start') {
          const newStart = snapDay(snap.start + dms);
          // Clamp start to not exceed (end - MIN_DURATION)
          // Handle should stop, not push the other handle
          const maxStart = t.end.getTime() - DAY_MS;
          t.start = new Date(Math.min(newStart, maxStart));
        } else {
          const newEnd = snapDay(snap.end + dms);
          // Clamp end to not go below (start + MIN_DURATION)
          // Handle should stop, not push the other handle
          const minEnd = t.start.getTime() + DAY_MS;
          t.end = new Date(Math.max(newEnd, minEnd));
        }

        // Real-time bidirectional constraint solving during drag
        if (this.enforceDeps) {
          propagateDeps(t, snap.allPositions);
        }

        data.value = [...data.value];
      },

      onEnd: (_canceled: boolean) => {
        if (dragPointerId >= 0 && (this as any).hasPointerCapture?.(dragPointerId)) {
          (this as any).releasePointerCapture(dragPointerId);
        }
        dragPointerId = -1;
        setGestureActive(false);

        // Final propagation on commit (if not canceled)
        if (this.enforceDeps && !_canceled) {
          const t = dragController.target as GanttTask | null;
          if (t) {
            propagateDeps(t);
            data.value = [...data.value];
          }
        }
        commit();
      },
    });

    this.addEventListener("pointerleave", () => {
      if (!dragController.active && !wheelController.active) hover.value = null;
    });

    // Hover tracking while idle. Without this, ctrl+wheel has no target.
    this.addEventListener("pointermove", (e) => {
      if (dragController.active || wheelController.active) return;
      hover.value = findAtPixelY(localPoint(e as PointerEvent).y);
    });

    this.addEventListener("pointerdown", (e) => {
      if (dragController.active) return;
      const pe = e as PointerEvent;
      // Pull keyboard focus to the host so arrow keys / inc-dec work after
      // a click — without this, focus stays on whatever was clicked last
      // (often <body>) and chart keydowns never fire.
      (this as any).focus?.();
      const { x, y } = localPoint(pe);
      const t = findAtPixelY(y);
      if (!t) return;

      const sx = (xScale.value as any)(t.start);
      const ex = (xScale.value as any)(t.end);
      // Larger hit tolerance for touch/pen so the resize handles are grabbable.
      const edgeTol = pe.pointerType === "mouse" ? 6 : 24;
      let kind: DragKind;

      // Check which edge is closer when both are within edge distance
      // This fixes the bug where narrow tasks always detect 'start' because it's checked first
      const distToStart = Math.abs(x - sx);
      const distToEnd = Math.abs(x - ex);

      if (distToStart <= edgeTol && distToEnd <= edgeTol) {
        // Both edges are within range - choose the closer one
        kind = distToStart < distToEnd ? 'start' : 'end';
      } else if (distToStart <= edgeTol) {
        kind = 'start';
      } else if (distToEnd <= edgeTol) {
        kind = 'end';
      } else if (x >= sx && x <= ex) {
        kind = 'move';
      } else {
        return;
      }

      dragPointerId = pe.pointerId;
      selected.value = t;
      (this as any).setPointerCapture(pe.pointerId);
      dragController.begin(t, dragConfig(kind, xToMs(x)));
      pe.preventDefault();
    });

    this.addEventListener("click", (e) => {
      // A click here only fires when no drag is live (dragController consumes
      // the gesture otherwise). Treat clicks outside any bar as deselect.
      if (dragController.active) return;
      (this as any).focus?.();
      const { x, y } = localPoint(e as PointerEvent);
      const t = findAtPixelY(y);
      if (!t) { selected.value = null; return; }
      const sx = (xScale.value as any)(t.start);
      const ex = (xScale.value as any)(t.end);
      if (x < sx || x > ex) { selected.value = null; return; }
      selected.value = selected.value === t ? null : t;
    });

    // ─── Wheel — ctrl/cmd+wheel resizes the hovered/selected task's end ───
    // Shared wheelController gives us Esc-revert + meta-keyup commit for free.
    const wheelConfig = {
      snapshot: (t: GanttTask): DragSnap => {
        setGestureActive(true);
        // Capture all task positions for constraint solving
        const allPositions = new Map<string, {start: number; end: number}>();
        const rows = data.value as GanttTask[];
        for (const task of rows) {
          allPositions.set(task.id, {
            start: task.start.getTime(),
            end: task.end.getTime()
          });
        }
        return { start: t.start.getTime(), end: t.end.getTime(), originMs: 0, kind: 'end' as DragKind, allPositions };
      },
      restore: (_t: GanttTask, snap: DragSnap) => {
        // Restore ALL tasks to snapshot positions (not just the resized one)
        const rows = data.value as GanttTask[];
        for (const task of rows) {
          const pos = snap.allPositions.get(task.id);
          if (pos) {
            task.start = new Date(pos.start);
            task.end = new Date(pos.end);
          }
        }
        data.value = [...data.value];
      },
      onEnd: () => {
        setGestureActive(false);
        // Constraints are now enforced in real-time during wheel gesture
        commit();
      },
    };
    this.addEventListener("wheel", (e) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey && !we.metaKey) return;
      we.preventDefault(); we.stopPropagation();
      const t = wheelController.begin(hover.value ?? selected.value, wheelConfig, { pinch: !realModifierDown() });
      if (!t) return;
      const curDays = Math.max(1, Math.round((t.end.getTime() - t.start.getTime()) / DAY_MS));
      const step = dynamicWheelStep(curDays, we.shiftKey);
      const delta = (we.deltaY < 0 ? +step : -step) * DAY_MS;
      // Enable constraint propagation during wheel gesture (real-time enforcement)
      setRange(t, t.start.getTime(), t.end.getTime() + delta, false);
    }, { passive: false });

    // ─── Keyboard ────────────────────────────────────────────────────────
    // Escape: if a gesture is live, the dragController/wheelController already
    // owns it (capture-phase keydown reverts). The chart-level handler only
    // sees Escape when no gesture is active — then it clears selection.
    this.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      const rows = data.value as GanttTask[];
      const cur = selected.value;
      const i = cur ? rows.indexOf(cur) : -1;
      if (ke.key === "Escape") {
        if (cur) { selected.value = null; ke.preventDefault(); }
        return;
      }
      // Tab — navigate between tasks; ←/→ also navigate when no task is
      // selected, otherwise edit (see below).
      if (ke.key === "Tab") {
        const dir = ke.shiftKey ? -1 : +1;
        const n = rows.length;
        if (n === 0) return;
        const next = rows[((i < 0 ? 0 : i + dir) + n) % n] ?? null;
        selected.value = next; ke.preventDefault(); return;
      }
      if (!cur) return;
      const step = ke.shiftKey ? 7 : 1;
      // ←/→ shift the whole task (preserves duration).
      // ↑/↓ inc/dec duration (extend or shrink the end).
      if (ke.key === "ArrowRight") { nudge(cur, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowLeft")  { nudge(cur, -step); ke.preventDefault(); }
      else if (ke.key === "ArrowUp")    { resize(cur, +step); ke.preventDefault(); }
      else if (ke.key === "ArrowDown")  { resize(cur, -step); ke.preventDefault(); }
    });

    // ─── Time axis (bottom) ────────────────────────────────────────────────
    const axisY = derive(() => plotY + plotH.value);
    s(line(
      Vec.derive(() => ({ x: plotX, y: axisY.value })),
      Vec.derive(() => ({ x: plotX + plotW.value, y: axisY.value })),
      { thin: true, opacity: 0.5, stroke: "#888" },
    ));
    // Ticks: pick from d3-scale.
    // We render up to ~8 ticks; each tick re-derives from xScale + plotH.
    const MAX_TICKS = 8;
    for (let k = 0; k < MAX_TICKS; k++) {
      const tickInfo = derive(() => {
        const sc: any = xScale.value;
        const ticks: Date[] = sc.ticks(MAX_TICKS) as Date[];
        const fmt = sc.tickFormat(MAX_TICKS);
        const t = ticks[k];
        return t ? { x: sc(t) as number, label: fmt(t) as string } : null;
      });
      const tx = derive(() => tickInfo.value?.x ?? -9999);
      const text = derive(() => tickInfo.value?.label ?? "");
      const opacity = derive(() => (tickInfo.value ? 1 : 0));
      s(
        line(
          Vec.derive(() => ({ x: tx.value, y: plotY })),
          Vec.derive(() => ({ x: tx.value, y: axisY.value })),
          { thin: true, stroke: "#888", opacity: derive(() => opacity.value * 0.15) },
        ),
        line(
          Vec.derive(() => ({ x: tx.value, y: axisY.value })),
          Vec.derive(() => ({ x: tx.value, y: axisY.value + 4 })),
          { thin: true, stroke: "#888", opacity: derive(() => opacity.value * 0.6) },
        ),
        label(
          Vec.derive(() => ({ x: tx.value, y: axisY.value + 16 })),
          text,
          { size: 10, align: Anchor.Center, fill: "#888", opacity },
        ),
      );
    }

    // Today marker — only drawn if "now" lands inside the visible domain.
    const nowMs = Date.now();
    const nowX = derive(() => {
      const sc: any = xScale.value;
      const [d0, d1] = sc.domain() as [Date, Date];
      if (nowMs < d0.getTime() || nowMs > d1.getTime()) return null;
      return sc(new Date(nowMs)) as number;
    });
    s(line(
      Vec.derive(() => ({ x: nowX.value ?? -9999, y: plotY })),
      Vec.derive(() => ({ x: nowX.value ?? -9999, y: axisY.value })),
      { thin: true, dashed: true, stroke: "#e08888", opacity: derive(() => nowX.value == null ? 0 : 0.7) },
    ));

    // ─── Row labels (live read so reorder reflows) ─────────────────────────
    const MAX_ROWS = rows0.length;
    for (let idx = 0; idx < MAX_ROWS; idx++) {
      const di = (): GanttTask | null => sortedData.value[idx] ?? null;
      // Get the tweened y position for this task
      const getY = (): number => {
        const d = di();
        if (!d) return rowY(idx);
        const entry = taskYCells.get(d.id);
        return entry ? entry.yCell.value : rowY(idx);
      };
      const getYCenter = (): number => {
        const d = di();
        if (!d) return rowCenterY(idx);
        const entry = taskYCells.get(d.id);
        return entry ? entry.yCenter.value : rowCenterY(idx);
      };

      s(label(
        Vec.derive(() => ({ x: plotX - 8, y: getYCenter() })),
        derive(() => di()?.label ?? ""),
        { size: 11, align: Anchor.Right, fill: "#bbb", opacity: 0.85 },
      ));

      // Row highlight (subtle background on hover/selected).
      const rowFill = derive(() => {
        const d = di(); if (!d) return 0;
        return (hover.value === d || selected.value === d) ? 0.05 : 0;
      });
      const rh = s(rect(
        derive(() => plotX),
        derive(() => getY()),
        derive(() => plotW.value),
        ROW_H,
        { fill: "#ffffff", opacity: rowFill },
      ));
      rh.el.style.pointerEvents = "none";
      rh.el.style.transition = "opacity 0.1s ease";
    }

    // ─── Task bars ─────────────────────────────────────────────────────────
    for (let idx = 0; idx < MAX_ROWS; idx++) {
      const di = (): GanttTask | null => sortedData.value[idx] ?? null;
      const base = (() => {
        const t = rows0[idx]; return t ? this.#color(idx, t) : '#888';
      })();
      const hoverColor = lightenHex(base, 0.35);

      // Get tweened y position for this task
      const getY = (): number => {
        const d = di();
        if (!d) return rowY(idx);
        const entry = taskYCells.get(d.id);
        return entry ? entry.yCell.value : rowY(idx);
      };
      const getYCenter = (): number => {
        const d = di();
        if (!d) return rowCenterY(idx);
        const entry = taskYCells.get(d.id);
        return entry ? entry.yCenter.value : rowCenterY(idx);
      };

      const barY = derive(() => getY());
      const barCY = derive(() => getYCenter());
      const xS = derive(() => { const d = di(); return d ? (xScale.value as any)(d.start) as number : 0; });
      const xE = derive(() => { const d = di(); return d ? (xScale.value as any)(d.end)   as number : 0; });
      const barW = derive(() => Math.max(0, xE.value - xS.value));
      const fill = derive(() => {
        const d = di();
        return selected.value === d ? "#fff" : hover.value === d ? hoverColor : base;
      });

      const tile = s(rect(xS, barY, barW, ROW_H, { fill, corner: 3 }));
      tile.el.style.cursor = "grab";
      tile.el.style.touchAction = "none";
      // Value geometry (x/width = task start/duration) is write-through — no settle.

      // ─── Drag-to-reorder (WIN-287) ────────────────────────────────────────
      // When canReorder is true and sortBy='index', dragging a row up/down
      // reorders the task list. The filter yields to time-axis resize handles.
      biEffect(() => {
        const enabled = this._canReorderCell.value && this._sortByCell.value === 'index';
        const task = di();  // Get CURRENT task at this position, not initial snapshot
        if (!enabled || !task || !task.id) {
          tile.el.style.cursor = "grab";
          return;
        }

        tile.el.style.cursor = "grab";
        let initialSnapshot: GanttTask[] = [];
        const detach = attachReorderGesture({
          hitEl: tile.el,
          dragEl: tile.el,
          itemId: task.id,
          host: this,
          // Yield to resize handles on the time-axis (left/right edges of bar).
          // This ensures horizontal drags on handles trigger resize, not reorder.
          filter: (e) => {
            const d = di();
            if (!d) return true;
            const { x } = localPoint(e);
            const sx = (xScale.value as any)(d.start) as number;
            const ex = (xScale.value as any)(d.end) as number;
            const edgeTol = e.pointerType === "mouse" ? 6 : 24;
            // Only allow reorder if pointer is away from both edges
            return x >= sx + edgeTol && x <= ex - edgeTol;
          },
          getInitialOrder: () => (data.value as GanttTask[]).map(t => t.id),
          computeTargetIndex: (e) => {
            const { y } = localPoint(e);
            // Map pointer y to row index
            const raw = (y - plotY) / ROW_STEP;
            return Math.floor(raw);
          },
          onActivate: () => {
            // Snapshot the initial task array for potential revert
            initialSnapshot = [...(data.value as GanttTask[])];
          },
          onPreview: (order) => {
            // Imperatively reorder the data array. When sortBy='index', sortedData
            // will reflect this new order and the existing y-cell tween system
            // (lines 199-239) will animate rows to their new positions.
            const tasks = data.value as GanttTask[];
            const byId = new Map(tasks.map(t => [t.id, t]));
            const reordered = order.map(id => byId.get(id)).filter(Boolean) as GanttTask[];
            if (reordered.length === tasks.length) {
              data.value = reordered;
            }
          },
          onEnd: (finalOrder, canceled) => {
            if (canceled) {
              // Revert to the initial snapshot from onActivate
              data.value = initialSnapshot;
              this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled: true } }));
              return;
            }

            // Commit: check if order actually changed from initial
            const initialIds = initialSnapshot.map(t => t.id);
            const changed = finalOrder.some((id, i) => id !== initialIds[i]);
            if (changed) {
              // Data is already reordered from onPreview; notify caller and trigger tweens
              this._reorderTickCell.value = this._reorderTickCell.value + 1;
              this.onReorder?.(finalOrder.slice());
              this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled: false, reorder: true } }));
            } else {
              this.dispatchEvent(new CustomEvent("gesturecommit", { detail: { canceled: false } }));
            }
          },
        });

        // Cleanup when effect re-runs or component unmounts
        return detach;
      });

      // Inside label (task name) — shown when bar wide enough.
      const inOpacity = derive(() => barW.value >= 60 ? 1 : 0);
      const labelFill = derive(() => { const d = di(); return selected.value === d ? base : "#fff"; });
      s(label(
        Vec.derive(() => ({ x: xS.value + 8, y: barCY.value })),
        derive(() => di()?.label ?? ""),
        { size: 11, align: Anchor.Left, fill: labelFill, opacity: inOpacity },
      ));

      // Duration label (outside, right of bar) on hover/select.
      const showDur = derive(() => {
        const d = di();
        return (hover.value === d || selected.value === d) ? 1 : 0;
      });
      s(label(
        Vec.derive(() => ({ x: xE.value + 6, y: barCY.value })),
        derive(() => {
          const d = di(); if (!d) return "";
          const days = Math.round((d.end.getTime() - d.start.getTime()) / DAY_MS);
          return `${days}d`;
        }),
        { size: 10, align: Anchor.Left, fill: "#aaa", opacity: showDur },
      ));

      // Resize handles at edges — visible on hover/selected.
      const handleR = derive(() => { const d = di(); return selected.value === d ? 5 : 4; });
      const handleOpacity = derive(() => {
        const d = di();
        return (hover.value === d || selected.value === d) ? 1 : 0;
      });
      const handleFill = derive(() => { const d = di(); return selected.value === d ? "#fff" : hoverColor; });

      const startHandle = s(circle(
        Vec.derive(() => ({ x: xS.value, y: barCY.value })),
        handleR,
        { fill: handleFill, stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity },
      ));
      startHandle.el.style.cursor = "ew-resize";
      startHandle.el.style.transition = hoverTransition("opacity");
      startHandle.el.style.touchAction = "none";

      const endHandle = s(circle(
        Vec.derive(() => ({ x: xE.value, y: barCY.value })),
        handleR,
        { fill: handleFill, stroke: "#0b0d12", strokeWidth: 1.5, opacity: handleOpacity },
      ));
      endHandle.el.style.cursor = "ew-resize";
      endHandle.el.style.transition = hoverTransition("opacity");
      endHandle.el.style.touchAction = "none";
    }

    // ─── Dependency connectors ────────────────────────────────────────────
    // Finish-to-start orthogonal arrows: predecessor end-edge → small stub →
    // vertical channel → small stub → dependent start-edge. Routed via the
    // task gap, so the path slots between rows instead of overlapping bars.
    ensureArrowMarker((this as any).svg as SVGSVGElement);
    const STUB = 8;       // horizontal stub before the bar edge
    const ARROW_GAP = 6;  // space before successor bar so arrowhead doesn't overlap

    // Build a (id → live index) lookup that re-derives when sort order changes.
    const indexById = derive(() => {
      const m = new Map<string, number>();
      const rows = sortedData.value;
      for (let i = 0; i < rows.length; i++) m.set(rows[i]!.id, i);
      return m;
    });

    // One pathD per dependency edge; iterate over the initial dep set —
    // pathD's `d` string is reactive, so positions follow drag/resize.
    type DepEdge = { from: string; to: string };
    const initialEdges: DepEdge[] = [];
    for (const t of rows0) for (const dep of t.deps ?? []) initialEdges.push({ from: getDepId(dep), to: t.id });

    for (const edge of initialEdges) {
      // Live lookup from sortedData (re-derives when sort order changes).
      const fromTask = (): GanttTask | null => {
        const idx = indexById.value.get(edge.from);
        return idx == null ? null : (sortedData.value[idx] ?? null);
      };
      const toTask = (): GanttTask | null => {
        const idx = indexById.value.get(edge.to);
        return idx == null ? null : (sortedData.value[idx] ?? null);
      };

      const dStr = derive(() => {
        const f = fromTask();
        const t = toTask();
        if (!f || !t) return "";
        const xS = xScale.value as any;
        const x0 = xS(f.end) as number;
        const x1 = xS(t.start) as number;
        // Get tweened y center positions for each task
        const fEntry = taskYCells.get(f.id);
        const tEntry = taskYCells.get(t.id);
        const y0 = fEntry ? fEntry.yCenter.value : plotY + ROW_H / 2;
        const y1 = tEntry ? tEntry.yCenter.value : plotY + ROW_H / 2;
        // Step path: out from f end, vertical to t row, in to t start.
        // If t.start is to the left of f.end, route around: go right STUB,
        // down/up half a row, back left, vertical, then in to t.start.
        const tipX = x1 - ARROW_GAP;
        if (tipX > x0 + STUB) {
          const midX = x0 + STUB;
          return `M ${x0} ${y0} L ${midX} ${y0} L ${midX} ${y1} L ${tipX} ${y1}`;
        }
        // Back-route (predecessor finishes AFTER successor starts — overlap).
        const stepDown = (y1 > y0 ? +1 : -1) * ROW_GAP / 2;
        const lift = y0 + stepDown;
        const outX = x0 + STUB;
        const backX = Math.min(tipX - STUB, x1 - STUB);
        return `M ${x0} ${y0} L ${outX} ${y0} L ${outX} ${lift} L ${backX} ${lift} L ${backX} ${y1} L ${tipX} ${y1}`;
      });

      const involved = derive(() => {
        const sel = selected.value;
        const hov = hover.value;
        const f = fromTask(); const t = toTask();
        if (!sel && !hov) return false;
        return sel === f || sel === t || hov === f || hov === t;
      });
      const opacity = derive(() => involved.value ? 1 : 0.45);
      const stroke = derive(() => involved.value ? "#fff" : "#7a8390");

      const p = pathD(dStr, {
        stroke, strokeWidth: derive(() => involved.value ? 1.6 : 1.1),
        fill: "none", cap: "round", join: "round", opacity,
      });
      const shape = s(p);
      // Arrowhead via the bireactive shared marker.
      shape.el.setAttribute("marker-end", "url(#bireactive-arrow)");
      shape.el.style.pointerEvents = "none";
      shape.el.style.transition = "stroke 0.12s ease, stroke-width 0.12s ease, opacity 0.12s ease";
    }

    // ─── Caption / readout ────────────────────────────────────────────────
    const statusText = derive(() => {
      const base = "Gantt — click select · Tab navigate · ←/→ shift · ↑/↓ resize · drag body/handles · ctrl+wheel resize · Esc revert";
      const canReorder = this._canReorderCell.value && this._sortByCell.value === 'index';
      return canReorder ? base + " · drag row to reorder" : base;
    });
    s(label(
      Vec.derive(() => ({ x: Wc.value / 2, y: 12 })),
      statusText,
      { size: 11, align: Anchor.Center, opacity: 0.7 },
    ));

    this.#bridge(data, hover, selected);
  }

  #bridge(
    data: ReturnType<typeof cell<readonly GanttTask[]>>,
    hover: ReturnType<typeof cell<GanttTask | null>>,
    selected: ReturnType<typeof cell<GanttTask | null>>,
  ) {
    const idOf = (d: GanttTask | null) => d?.id ?? null;
    const datumAt = (id: string | null) =>
      id == null ? null : (data.value as GanttTask[]).find(d => d.id === id) ?? null;
    let applying = false;
    const bridge = makeBridge({
      setHover: (key) => { applying = true; hover.value = datumAt(key); applying = false; },
      setSelect: (key) => { applying = true; selected.value = datumAt(key); applying = false; },
    });
    (this as unknown as ElementWithBridge).brSync = bridge;
    biEffect(() => { if (!applying) bridge.emitHover(idOf(hover.value)); });
    biEffect(() => { if (!applying) bridge.emitSelect(idOf(selected.value)); });
  }
}
