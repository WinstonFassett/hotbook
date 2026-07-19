# Transition Timing

The canonical reference for chart motion in hotbook. Three cells, no
multipliers. Every transition in every chart reads one of these cells
directly at call-time.

## The three motion cells

| Cell | Unit | Default | What it governs |
|---|---|---|---|
| `motionMs` | ms | 300 | All layout and fade transitions — drill, config change (sort/measure/depth), value-commit, mark enter/exit. One duration for "the chart is changing shape or membership." |
| `hoverMs` | ms | 100 | Hover/focus micro-feedback — stroke, opacity, highlight rect tracking cursor. Distinct nature (direct manipulation feedback), own cell. |
| `separation` | px | 1 | Visual separation between hierarchical marks. Drives sunburst arc stroke width, treemap paddingInner/Outer, pack border thickness, icicle gaps. Not a duration — a spatial value. |

**That's it. Three cells. No multipliers.** Anything that doesn't map
to one of these is a bug.

## Why one duration for all layout/fade transitions

The previous model split layout transitions into named categories (drill,
settle, enter, exit) with separate durations. In practice the CSS-transition
mechanism on icicle/treemap/pack tile rects is trigger-agnostic — it fires
on any `setAttribute` of x/y/w/h, whether caused by drill, config change, or
value-commit. Branching by trigger would require fragile host-class toggling
with race conditions on rapid double-drill or config-during-drill.

One duration is honest about what the mechanism actually supports. If a
specific transition ever needs a different duration, it gets its own cell —
not a multiplier off `motionMs`.

## What died (was over-specified or slop)

| Dead thing | Why |
|---|---|
| `settleMs` | Collapsed into `motionMs`. The settle-vs-drill split was aspirational; the CSS mechanism can't branch by trigger cleanly. |
| `drillMs` | Collapsed into `motionMs`. Drill is the most common layout trigger but not semantically separate from config changes at the mechanism level. |
| `enterMs` / `exitMs` | Collapsed into `motionMs`. Mark appear/disappear is the same nature as other layout transitions. |
| `sortSec` | Renamed to `motionMs` and converted to ms. Was in seconds (0.35s) for the anim-clock tween engine; now ms (300ms) with `/1000` at the call site where the tween API demands seconds. Bad name — it wasn't just sort, it was all layout transitions on the anim-clock family. |
| `baseMs × N` multipliers | Gone. No multiplier indirection. |
| `CRUMB_FADE_MS = 160` | Now `motionMs`. |
| `background 80ms` (treetable) | Now `motionMs`. |
| `TRANSITION_BASE_MS` re-export | Gone. |

## The one real distinction: hover vs everything else

Hover/focus micro-feedback is direct manipulation — the user's cursor is
the driver, and the feedback must feel instantaneous. 100ms. Everything
else is autonomous (the chart is reacting to a state change, not to the
cursor) and uses `motionMs` (300ms).

This isn't a multiplier distinction — it's a different nature. Hover gets
its own cell because it's a different kind of motion, not because it's a
faster version of the same motion.

## Per-chart transition map

### Icicle / Treemap
| Transition | Cell |
|---|---|
| Tile rect x/y/w/h (drill, config, value-commit) | `motionMs` |
| Label group transform | `motionMs` |
| Hover highlight | `hoverMs` |
| Breadcrumb appear/disappear | `motionMs` |

### Pack
| Transition | Cell |
|---|---|
| Circle r (drill, config, value-commit) | `motionMs` |
| wrapG transform (position) | `motionMs` |
| Hover highlight | `hoverMs` |
| Breadcrumb appear/disappear | `motionMs` |
| Peer slide-off | `motionMs` (no fade — transform only) |

### Sunburst
| Transition | Cell |
|---|---|
| Arc path d (drill, config) | `motionMs` (JS tween — path d can't CSS-transition) |
| Hover highlight | `hoverMs` |
| Breadcrumb appear/disappear | `motionMs` |
| Peer slide-off | `motionMs` (no fade — angular width collapses to 0) |

### Anim-clock charts (bar, pie, sankey, tree, gantt, radar, concentric-arc)
| Transition | Cell |
|---|---|
| All layout tweens (sort, measure swap, value change, reorder) | `motionMs / 1000` (tween API takes seconds) |
| Hover highlight | `hoverMs` |

## Principle 12

> **Single source of truth for timing.** All chart durations live as
> configurable cells in `runtime-config.ts` (`hoverMs`, `motionMs`,
> `separation`). No hardcoded ms values in gesture handlers or chart
> code. No multipliers — each duration is independently tunable. The
> tweaks pane exposes all of them.

Defaults align with cross-design-system norms (Carbon, Material 3,
Polaris, Tailwind): ~100ms micro, ~300ms state-change/layout.

## Files

- `packages/bireactive/src/lib/runtime-config.ts` — the cells (`motion.hoverMs`, `motion.motionMs`, `motion.separation`)
- `packages/bireactive/src/lib/transitions.ts` — `TRANSITION_DURATION.hover` / `.motion` getters
- `packages/bireactive/src/lib/motion-tweaks-panel.ts` — the lil-gui panel
