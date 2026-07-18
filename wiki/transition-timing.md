# Transition Timing

Defines the categories of motion in hotbook charts, which tweak controls each, and how they relate.

## Categories

| Category | What it covers | Tweak | Default | How it's used |
|----------|---------------|-------|---------|---------------|
| **Settle** | Value change, resize, post-commit layout | `base (ms)` | 100 | `baseMs × 2.5` via `TRANSITION_DURATION.settle` |
| **Hover** | Micro-feedback (stroke, opacity on hover/focus) | `base (ms)` | 100 | `baseMs × 1.0` via `TRANSITION_DURATION.hover` |
| **Drill** | Drill in/out (hierarchical zoom) | `drill (ms)` | 800 | `drillMs` directly |
| **Enter** | Mark appear (fade in on first render / filter) | `enter (ms)` | 400 | `enterMs` directly |
| **Exit** | Mark disappear (fade out before eviction) | `exit (ms)` | 400 | `exitMs` directly |
| **Sort** | Reorder / measure-swap tween (anim-clock charts) | `sort (s)` | 0.35 | `sortSec` directly |

## Two models, one panel

- **Multiplier roles** (settle, hover): derive from `baseMs`. Dragging base retunes both. This is Interaction Principle 12 — coherent rhythm from one root.
- **Independent roles** (drill, enter, exit, sort): have their own cell. These are conceptually different motions (not a "faster settle"), so they get their own knob.

## What each tweak does

- **base (ms)** — The rhythm root. Controls settle (×2.5) and hover (×1). Drag this to speed up or slow down value-change animations across all charts.
- **drill (ms)** — Drill in/out duration. Independent because drilling is a navigation action, not a value settle. Drag this to control how long the zoom-in/out takes on hierarchical charts.
- **enter (ms)** — How long a mark takes to fade in on first render or when filtered in.
- **exit (ms)** — How long a mark lingers before being evicted from the DOM after it's been removed from the data.
- **sort (s)** — Reorder/measure-swap tween for anim-clock charts (pie, etc.).
- **separation (px)** — Visual gap between hierarchical marks (stroke width, padding, gaps). Not timing — geometry. But lives in the same panel for convenience.

## What's NOT a separate tweak

- **Reorder** (drag-to-reorder slide) uses settle timing (`baseMs × 2.5`). Not its own knob.
- **Highlight** (highlight rect sliding) uses `baseMs × 1.5`. Not its own knob.

## Files

- `packages/bireactive/src/lib/runtime-config.ts` — the cells (`motion.baseMs`, `motion.drillMs`, etc.)
- `packages/bireactive/src/lib/transitions.ts` — `TRANSITION_DURATION` getters (settle, hover, drill, reorder, highlight)
- `packages/bireactive/src/lib/motion-tweaks-panel.ts` — the lil-gui panel
