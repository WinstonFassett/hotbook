# hotbook Interaction Principles

Design rules for gesture-based data visualization. This document lists goals, principles, and hard rules. Higher entries win when they conflict with lower ones.

This is a living document. The goal is **direct manipulation of datasets through data views and visualizations**: the user touches a data mark and the mark changes. The result should be **beautiful, intuitive, fluid, and best-of-breed**. The architecture is **consumer-driven reactive subscription**: a data kernel publishes data and pre-edit events, and charts subscribe and decide how to render. The system is bireactive, not top-down imperative.

---

## Goals

### 1. Direct manipulation of datasets through data views and visualizations
Wherever possible, the user touches the thing and the thing changes. Prefer the visualization over modals, forms, or indirection. The visualization is the UI.

### 2. Beautiful, intuitive, fluid, best-of-breed
The interaction should feel like a polished, native-quality app. Motion is smooth, feedback is immediate, and the user rarely has to think about how to do something.

### 3. Real-time feedback
Values and visualization update live during the gesture — not on release. Throttle or debounce for rendering cost, but never at the cost of perceived responsiveness. The user sees the effect of what they're doing as they do it.

### 4. Minimize thrashing
Preview and edit with the smallest change to the current view, then commit the rest. A single value change should not cause a whole-chart re-render unless the chart has no cheaper way to show the preview.

---

## Principles

### 5. One gesture, one user, usually one pre-edit
A user can make one gesture at a time. That gesture usually edits one value. A chart usually only needs to preview at most one live pre-edit at a time. Charts should generally optimize to be maximally informative while minimizing thrashing during a gesture.

### 6. Gestures are speculative pre-edits
A gesture is a **pre-edit** of an uncommitted value, not a value edit itself. Escape at any point cancels cleanly, reverting to the **committed view**. Commit happens on release (or equivalent explicit action). The system may need to snapshot the committed view at gesture start to support this.

> Implementation note: `onUpdate` calls during a gesture are preview updates. Currently hotbook writes them to state immediately. Works in practice (escape reverts), but the speculative contract isn't formally exposed to consumers.

### 7. Defer gesture-induced reordering until commit
If a pre-edit would change a derived sort order, the reorder is **deferred** until `commit`. The chart should use the ordering at the start of the gesture while the gesture is active. Reordering mid-gesture would disrupt the user's visual context.

### 8. Defer thrashing-causing relayout and transitions until commit
Full layout recomputes and transitions that would move sibling marks (reorder, relayout, partition, pack, treemap) are **deferred** while the gesture is active — the chart should not recompute `d3` layout or shuffle sibling positions mid-gesture. The full layout transition should run after `commit`. The gesture should hold the relevant state until it completes.

### 9. Preview by patching the existing view when possible
If the edited mark can be scaled linearly or from its center, the chart should resize it live during the gesture and **do its best to scale the matching axis/domain to fit the preview value**. This is the default for bar, area, scatter, and similar Cartesian marks. If the chart cannot patch the view cheaply, it may do a full re-render. The `Editor` does not dictate the strategy; it signals `Drafting` or `Idle`.

### 10. Charts are autonomous consumers
A chart is a consumer of data and pre-edit events. The data kernel publishes; the chart subscribes and decides what to render. We do not force all charts to behave the same way; we provide defaults and let components choose. A chart may expose settings to tweak its preview behavior.

### 11. Respect motion preferences — reactive vs. autonomous
Honor `prefers-reduced-motion`. The distinction:
- **Reactive motion** — direct manipulation feedback, real-time response to physical input. Stays on. Suppressing it would break the gesture.
- **Autonomous motion** — post-commit transitions, reorder animations, mode-change morphs. Suppressible.

Under reduced-motion: suppress autonomous, keep reactive.

### 12. Single source of truth for timing
All chart durations live as configurable cells in `runtime-config.ts` (`hoverMs`, `settleMs`, `drillMs`, `enterMs`, `exitMs`). No hardcoded ms values in gesture handlers or chart code. No multipliers — each duration is independently tunable. The tweaks pane exposes all of them. See `wiki/transition-timing.md` for the canonical reference and per-chart mapping.

### 13. Transitions are interruptible at any time
Any autonomous transition (post-commit, reorder, mode-change morph) can be interrupted by user input without snapping, flashing, or corrupting state. Transition effects are disposable. When a new state arrives, the effect can be disposed and the frontend can decide to let it finish or jump to the new state. When interrupted, the element should stay at its current visual position and the new transition should start from there. The system should be in a coherent visual state, not mid-commit.

### 14. Visual cohesion — elements that belong together move together
A label belongs to its data mark. A number belongs to its slice. When a shape moves, its label moves with it — not on a separate trajectory, not on a separate timeline. Detachment is a design choice, not a default.

Label types: name label, value label, value-units label. Each has its own threshold behavior (visibility, inside/outside, size). When a label can't track its shape, acceptable options are: fade out early and fade in at destination; or hold position and fade out. Drifting independently is not the default.

Corollary: interpolate what changes. Color changing during a transition should be tweened. A label crossing a threshold (inside → outside) should tween position continuously, not cut.

### 15. Touch and mouse are equivalent gesture surfaces
Direct manipulation should work on touch as well as mouse. Same gestures, same feedback, same mechanics. Where platform differences require adaptation (no hover on touch, different hit target sizes), adapt — but avoid dropping capabilities.

### 16. Layout should contain the data — zoom-to-fit on commit
After any commit (gesture end, data change), the visualization should animate or snap to contain all data in bounds. Avoid clipping data or leaving persistent empty space. This is a post-commit operation, not mid-gesture.

### 17. Hierarchical modes support animated drill and multi-level display
h-treemap, h-icicle, h-radial (sunburst) should:
- Support drill-down and drill-up with animated transitions — not hard cuts. Drilling in feels like zooming into the hierarchy; drilling out reverses it. The transition communicates the level change.
- Show multiple levels simultaneously where the layout supports it. Icicle and sunburst do this naturally; h-treemap should show breadcrumb or context on drill. Drilling to level N should reveal N+1 within the same view where possible.
- Quality bar: `~/dev/tries/2026-04-26-project-allocation-editor-visualizer` — multi-level visible, animated drill, icicle-style level continuity, sunburst with visible depth.

---

## Hard rules

- **No overflow:** A mark must never be rendered outside the chart component bounds. If a pre-edit would exceed the chart domain, the chart must scale the domain or do a full re-render. Dynamic domain scaling is the default for Cartesian charts; hierarchical charts can scale outer bounds or hide/show levels.
- **A gesture should be cancellable and revert to the committed view.**
- **There is usually one active user gesture at a time.**
- **Autonomous motion respects `prefers-reduced-motion`.**
- **Transition effects are disposable.** When state changes, the effect can be disposed and the chart can decide to let it finish or jump.
- **Avoid reordering or full layout relayout during a gesture without an explicit chart choice.**

---

## Rendering strategies

The chart chooses how to render. These are defaults, not requirements.

### Cartesian marks
- **Bar / area / scatter / line**: resize the edited mark and scale the matching axis/domain to fit the pre-edit value.
- **Pie / sunburst**: rebalance the edited mark and its siblings. The coordinate is a fixed total (360° for a full pie, or a parent value for a sunburst ring), so previewing a change inherently moves others.

### Hierarchical marks
- **Icicle / sunburst**: recompute the affected subtree inside the saved parent bounds, with the sibling ordering frozen at gesture start.
- **Treemap / circle pack**: scale the edited mark around its center, possibly rendering it as a puzzle-piece "atop" the original layout, while fading or hiding children. Whether children are also relaid out is a chart-specific option. If the pre-edit would exceed the chart domain, scale the domain or do a full re-render.

### Cross-tile / cross-chart
- Other charts bound to the same data should receive the pre-edit event by default. They can opt out or choose a different preview strategy (e.g. breadcrumb only). The data kernel publishes; each chart subscribes and decides what to render.

---

## Other hard interactions

### Filter and enter/exit transitions
Filtering should animate entering and exiting marks. Marks should not simply appear or disappear. The layout should also animate to contain the remaining data (zoom-to-fit on filter). The chart is a consumer of the filter state; it decides how to render the transition.

### Zoom, pan, and viewport
Charts should support zoom and pan where the data supports it. The viewport should preserve context and keep the user's point of focus. Selections and pre-edits should be stable across zoom/pan. The scatter chart already does this; it should be the model for other charts that can support it.

### Drag-to-reorder and keyboard reorder
Reordering can be a gesture. The chart can support drag-to-reorder and keyboard reorder (e.g. swap, move up/down). Reorder gestures should be cancellable and revert to the committed order. The reorder is committed on release. The chart can start an `Editor` with `intent: 'reorder'`. The same `commit`/`cancel` semantics apply as for pre-edits.

### Cross-tile selection
Selection is a cross-tile concept. If a mark is selected in one chart, other charts bound to the same data should reflect that selection by default. They can opt out or render selection differently. Linked zoom could be anchored on selection, but there is no plan for independent linked zoom.

### Cursor affordances
Cursors must be set on the **interactive element** (tile, handle, cell), never on the chart host or SVG container. Setting cursor on the host bleeds into dead areas (gaps between tiles, SVG background, padding) and misleads the user into thinking those areas are interactive. The icicle is the reference: tiles get `pointer`, edge handles get `row-resize`/`col-resize`, and the host has no cursor set — dead areas inherit the default. All hierarchical charts follow the same pattern.

### Testing and verification
Gesture effects and transitions must be testable. The `Editor` state machine should expose observable transitions. The chart's effect callbacks should be unit-testable. Transitions should be deterministic and interruptible. The test checklist in `wiki/gesture-test-checklist.md` should be the source of truth for coverage.

### Implementation correctness
Chart implementations must satisfy the invariants in `wiki/gesture-architecture.md` §"Implementation invariants":
- **Disposer discipline** — no memory leaks from undisposed subscriptions/listeners
- **Reactive-source ordering** — `derive()` depends on cells, not side-effect-populated structures
- **Drill and hover contracts** — hierarchical charts accept `drillId` and emit hover
- **Multi-instance ID hygiene** — no bare `id`/`clipPath`/`xlink:href` that collides across instances

These are correctness requirements, not style. Violations break multi-instance rendering, cross-chart sync, or leak memory.

---

*References: Shneiderman (1983), Hutchins/Hollan/Norman (1985), Bret Victor — Magic Ink (2006). See also tickets [4c6d] and [10b7].*
