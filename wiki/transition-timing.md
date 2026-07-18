# Transition Timing

The canonical reference for chart motion in hotbook. Every transition in
every chart maps to one of five motion categories. No multipliers, no
magic numbers — five independent cells, full stop.

## The five motion categories

| Motion | What it is | Cell | Default | Justification |
|---|---|---|---|---|
| **Hover** | Micro-feedback — hover/focus stroke, opacity, highlight rect tracking cursor | `hoverMs` | 100 | Cross-system norm for micro-interactions (Carbon `fast-02` 110ms, Material `short3` 150ms). Direct manipulation feedback. |
| **Settle** | Autonomous post-commit — value change after drag-release, sort reorder, layout reflow after edit | `settleMs` | 250 | Cross-system norm for state-confirmation (Carbon `moderate-02` 240ms, Material `medium2` 300ms). Post-commit reflow. |
| **Drill** | Autonomous navigation — zooming into/out of hierarchy levels | `drillMs` | 300 | Hierarchical-specific. No design system has this as a named token; 300ms matches Material's "elements entering screen" (225ms) + tablet scaling. |
| **Enter** | Mark appear — fade in on first render or filter-in | `enterMs` | 400 | Cross-system norm for entering UI (Carbon `slow-01` 400ms, Material `long2` 450ms). DOM lifecycle. |
| **Exit** | Mark disappear — fade out before eviction | `exitMs` | 400 | Cross-system norm for leaving UI (Material 195-400ms). DOM lifecycle. |

**That's it. Five cells. Zero multipliers.** Anything that doesn't map to
one of these is a bug.

## What died (was slop)

These used to be treated as separate categories or magic constants. They
collapse into the five above:

| Dead thing | Actually is | Why |
|---|---|---|
| `reorder` role | Settle | Same nature (post-commit slide), uses `settleMs`. |
| `highlight` role | Hover | Tracks cursor — micro-feedback, uses `hoverMs`. |
| `baseMs × 2.5` for settle | `settleMs` cell | Multiplier was magic. Now independent cell. |
| `baseMs × 1.5` for highlight | `hoverMs` cell | Multiplier was magic. Now independent cell. |
| `baseMs × 1.0` for hover | `hoverMs` cell | Identity multiplier was pointless indirection. |
| `CRUMB_FADE_MS = 160` | `enterMs` | Breadcrumb appearing IS a mark entering. |
| `background 80ms` (treetable) | `settleMs` | Row background change is post-commit. |
| `transform 200ms` ghost fallback | `hoverMs` or instant | Ghost follows drag — micro-feedback. |
| `TRANSITION_BASE_MS` re-export | gone | No more base rhythm root. |
| `baseMs` cell | renamed `hoverMs` | Was the rhythm root; now just the hover duration. |

## The one real overlap: settle vs drill in hierarchical

When you drill into a hierarchy, tiles move to new positions. Is that
"settle" (post-commit reflow) or "drill" (navigation)?

**Answer: drill.** Principle 17 says drill is animated zoom navigation —
structurally bigger and more deliberate than a value tweak. So ALL motion
during a drill uses `drillMs`:

- Tile rect slide (x/y/width/height)
- Label group transform
- Circle radius grow
- Arc angular tween
- Peer slide-off-canvas

Settle is ONLY for non-drill commits in hierarchical:
- Drag-resize release (value change)
- Sort reorder
- Value edit commit

**Rule: if the focus changes, it's drill. If only values change, it's settle.**

## The present-gate question

Peers leaving on drill: is that "exit" (enter/exit category) or "drill"
(navigation)?

**Answer: drill.** Peers slide off-canvas as part of the navigation
motion. They ride the layout transform at `drillMs` until they're
off-screen. Not a fade, not an exit-delay.

**No fade on solid cards.** The solid-card physical metaphor requires
peers to slide away, not dissolve. Opacity transitions on present-gate
are forbidden in hierarchical charts. Peers stay at opacity 1 the entire
slide; they're clipped by the SVG viewport when off-canvas.

If peers blink instead of sliding, that's a layout bug (the transform
isn't animating), not a timing category problem.

## Per-chart transition map

### Icicle
| Transition | Motion | Cell |
|---|---|---|
| Tile rect x/y/w/h (drill) | Drill | `drillMs` |
| Tile rect x/y/w/h (resize/sort) | Settle | `settleMs` |
| Label group transform | Drill | `drillMs` |
| Hover highlight | Hover | `hoverMs` |
| Breadcrumb appear | Enter | `enterMs` |

### Treemap
| Transition | Motion | Cell |
|---|---|---|
| Tile rect x/y/w/h (drill) | Drill | `drillMs` |
| Tile rect x/y/w/h (resize/sort) | Settle | `settleMs` |
| Label group transform | Drill | `drillMs` |
| Hover highlight | Hover | `hoverMs` |
| Breadcrumb appear | Enter | `enterMs` |

### Pack
| Transition | Motion | Cell |
|---|---|---|
| Circle r (drill) | Drill | `drillMs` |
| Circle r (resize) | Settle | `settleMs` |
| wrapG transform (position) | Drill | `drillMs` |
| Hover highlight | Hover | `hoverMs` |
| Breadcrumb appear | Enter | `enterMs` |
| Peer slide-off | Drill | `drillMs` (no fade — transform only) |

### Sunburst
| Transition | Motion | Cell |
|---|---|---|
| Arc path d (drill) | Drill | `drillMs` (JS tween — path d can't CSS-transition) |
| Arc path d (resize) | Settle | `settleMs` |
| Hover highlight | Hover | `hoverMs` |
| Breadcrumb appear | Enter | `enterMs` |
| Peer slide-off | Drill | `drillMs` (no fade — angular width collapses to 0) |

## Principle 12 update

Principle 12 currently says "all durations derive from one base rhythm...
explicit multipliers of that base." Multipliers are magic numbers. The
principle becomes:

> **Single source of truth for timing.** All chart durations live as
> configurable cells in `runtime-config.ts` (`hoverMs`, `settleMs`,
> `drillMs`, `enterMs`, `exitMs`). No hardcoded ms values in gesture
> handlers or chart code. No multipliers — each duration is independently
> tunable. The tweaks pane exposes all of them.

Defaults align with cross-design-system norms (Carbon, Material 3,
Polaris, Tailwind): ~100ms micro, ~250ms state-confirmation, ~400ms
entering/leaving. Drill is our only custom addition (hierarchical
navigation).

## Files

- `packages/bireactive/src/lib/runtime-config.ts` — the cells (`motion.hoverMs`, `motion.settleMs`, `motion.drillMs`, `motion.enterMs`, `motion.exitMs`)
- `packages/bireactive/src/lib/transitions.ts` — thin re-exports for ergonomic access
- `packages/bireactive/src/lib/motion-tweaks-panel.ts` — the lil-gui panel

## TODO (violations to fix)

1. Add `settleMs` and `hoverMs` cells to `runtime-config.ts`; rename `baseMs` → `hoverMs`
2. Replace `TRANSITION_DURATION` multiplier getters with direct cell reads
3. Treemap tile rect → `drillMs` for drill (matches icicle)
4. Remove sunburst arc opacity fade (no-fade rule)
5. Remove treemap labelWrap opacity fade (no-fade rule)
6. Replace `CRUMB_FADE_MS = 160` with `enterMs`
7. Replace treetable `background 80ms` with `settleMs`
8. Replace ghost `transform 200ms` fallback with `hoverMs` or instant
9. Update principle 12 in `wiki/interaction-principles.md`
10. Update `motion-tweaks-panel.ts` to expose all 5 cells
