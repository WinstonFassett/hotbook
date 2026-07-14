# hotbook Interaction Principles

Design rules for gesture-based data visualization. Priority-ordered — higher rules win when they conflict with lower ones.

---

## Rules

### 1. Direct manipulation is the top value
Wherever possible, the user touches the thing and the thing changes. No modals, no forms, no indirection. The visualization is the UI.

### 2. Scale stability during manipulation
The coordinate system of the gesture does not change while the gesture is active. A pixel of drag means the same thing at the end of the gesture as it did at the start. No re-layout, no reorder, nothing that shifts what the gesture means mid-flight.

### 3. Real-time feedback
Values and visualization update live during the gesture — not on release. Throttle or debounce for rendering cost, but never at the expense of perceived responsiveness. The user sees the effect of what they're doing as they do it.

### 4. Good mechanics
Transitions use physics-appropriate easing. Elements animate from where they visually are at the moment a transition starts — not from stale pre-gesture positions. Snap-back is never acceptable.

### 5. Gesture atomicity — one gesture at a time
A gesture has a clear beginning and end. While a gesture is active, the system is committed to that gesture. No other dimension of the visualization mutates out from under the user. The gesture owns the state until it completes.

### 6. Gestures are speculative until committed
Live preview during a gesture is not a mutation — it's a preview. The entire gesture is a "what if." Escape at any point cancels cleanly, reverting to the exact state at gesture start. Commit happens on release (or equivalent explicit action). The system must snapshot state at gesture start to support this.

> Implementation note: `onUpdate` calls during a gesture are preview updates. Currently hotbook writes them to state immediately. Works in practice (escape reverts), but the speculative contract isn't formally exposed to consumers.

### 7. Derived reorders defer to commit
Sort order holds for the duration of a gesture. If the sort is derived (e.g. sorted by value), mid-gesture value changes do not trigger reorders — that would disorient the user and violate Rule 2. Reorder re-evaluation happens at commit (release), not during. If the gesture is canceled, no reorder occurs. The user sees any reorder as a single deliberate animation after they let go.

### 8. Feature exposure through affordance, not chrome
Features are exposed through the visualization itself — drag handles, hit zones, gestures — rather than external UI controls, unless the visualization cannot reasonably express them. The chart is the control surface. Every interaction that requires chrome instead of the data mark is *excise* (Victor, 2006) — extra effort that doesn't contribute to the user's goal.

### 9. Respect motion preferences — reactive vs. autonomous
Honor `prefers-reduced-motion`. The distinction:
- **Reactive motion** — direct manipulation feedback, real-time response to physical input. Always on. Suppressing it would break the gesture.
- **Autonomous motion** — settle transitions, reorder animations, mode-change morphs. Suppressible.

Under reduced-motion: suppress autonomous, keep reactive.

### 10. Single source of truth for timing
All durations and easing curves derive from one base rhythm — a design token or CSS variable. Role-specific durations (settle, enter/exit, reorder) are explicit multipliers of that base, not independent magic numbers. The system has a coherent rhythm that shakes out fractionally from one tunable root. No hardcoded ms values scattered through gesture handlers.

### 11. Transitions are interruptible at any time
Any autonomous transition (settle, reorder, mode-change morph) can be interrupted by user input without snapping, flashing, or corrupting state. When interrupted, the element stays at its current visual position and the new transition starts from there. The system is always in a coherent visual state, never mid-commit.

### 12. Visual cohesion — elements that belong together move together
A label belongs to its data mark. A number belongs to its slice. When a shape moves, its label moves with it — not on a separate trajectory, not on a separate timeline. Detachment is a design choice, not a default.

Label types: name label, value label, value-units label. Each has its own threshold behavior (visibility, inside/outside, size). When a label can't track its shape, acceptable options are: fade out early and fade in at destination; or hold position and fade out. Drifting independently is not acceptable.

Corollary: interpolate everything that changes. Color changing during a transition should be tweened. A label crossing a threshold (inside → outside) should tween position continuously, not cut.

### 13. Cross-view transitions preserve identity through shape
When transitioning between visualization modes, the primary visual object for each datum is its colored shape. Shapes morph continuously — the color block is the anchor of identity. Labels may detach briefly during a cross-view morph if needed, but shapes never disappear and reappear. Intermediate formations are acceptable when they make the morph legible. The user never loses track of where their data went.

### 14. Touch and mouse are equivalent gesture surfaces
Direct manipulation must work on touch as well as mouse. Same gestures, same feedback, same mechanics. Where platform differences require adaptation (no hover on touch, different hit target sizes), adapt — but don't drop capabilities.

### 15. Value edits scale live; order is frozen during gesture
When a gesture changes a value, the scale and bounds of the visualization update live so the mark stays under the pointer and the value remains readable. Only the displayed **order** is frozen while the gesture is active — the data store may change, but the layout does not reorder until `commit`. The per-chart `DataViewController` distinguishes `Gesturing` (live edits, frozen order) from `Settling` (autonomous transitions run) and `Idle`. `settle()` is called by the mechanism that knows the transition duration (CSS `transitionend`, `Anim` completion, or immediately for no transition).

**Radial exception:** resizing a slice inherently rebalances all other slices' angles — 360° is fixed total. This is acceptable because the proportion *is* the coordinate and the other slices moving is the expected feedback. Required: other slices reposition smoothly, not by jumping.

### 16. Layout always contains the data — zoom-to-fit on commit
After any commit (gesture end, data change), the visualization animates or snaps to contain all data in bounds. Never clip data or leave persistent empty space. This is a post-commit operation on the settle rhythm (Rule 10), not mid-gesture.

### 17. Hierarchical modes get the same transition and drill quality as flat modes
h-treemap, h-icicle, h-radial (sunburst) must:
- Transition between each other with continuous shape morphs, same quality as flat↔flat (Rule 13).
- Support drill-down and drill-up with animated transitions — not hard cuts. Drilling in feels like zooming into the hierarchy; drilling out reverses it. The transition communicates the level change.
- Show multiple levels simultaneously where the layout supports it. Icicle and sunburst do this naturally; h-treemap should show breadcrumb or context on drill. Drilling to level N should reveal N+1 within the same view where possible.
- Quality bar: `~/dev/tries/2026-04-26-project-allocation-editor-visualizer` — multi-level visible, animated drill, icicle-style level continuity, sunburst with visible depth.
- Flat↔hierarchical cross-mode transitions are a known gap and a big lift. Not required now, but the architecture shouldn't foreclose them.

---

## Current state audit

### Rule 1 — Direct manipulation
**Partial.** Resize (radial + bands) and reorder (radial + bands) work via DM. Color, name, add/remove, grouping — chrome only.

### Rule 2 — Scale stability
**✅** `dragOrderSnapshot` freezes layout during resize. Reorder locks pie to `dr.layoutMap`.

### Rule 3 — Real-time feedback
**✅** Resize and reorder both issue live `onUpdate` preview calls during gesture.

### Rule 4 — Good mechanics
**✅** Radial settle snap-back fixed (`dragSettlePrevAtoms` + interrupt `'reorder'` at drag end). Verified on device.

### Rule 5 — Gesture atomicity
**✅** One drag state flag active at a time. D3 drag handlers are mutually exclusive.

### Rule 6 — Speculative gestures
**Partial.** Escape works for resize (`_cancelResizeDrag`). Reorder has no escape path. Hotbook writes preview updates immediately — speculative contract not formally exposed.

### Rule 7 — Derived reorders defer to commit
**✅** Reorder `onUpdate` loop fires only at drag end.

### Rule 8 — Affordance not chrome
**Partial.** Gesture targets are the data marks. But name, color, add/remove are chrome-only.

### Rule 9 — Motion preferences
**Partial.** `prefers-reduced-motion` zeroes `DUR`, `REORDER_DUR`, `EXIT_DUR` — correctly suppresses autonomous. Drag-position updates use `.interrupt().attr()` not transitions, so reactive motion is already frame-driven. The distinction is implicitly correct but not by explicit design.

### Rule 10 — Single source of truth for timing
**Partial.** `constants.ts` has `DUR`, `REORDER_DUR`, `EXIT_DUR`, `DUR_MOVE`, `DUR_ENTER`, `DUR_EXIT`. Independent literals, not expressed as multipliers of a base. Coherent in practice; derivation not visible in code. See `wiki/cross-file-maintainability-audit.md` (WIN-288) and the linked sub-tickets for the remediation plan.

### Rule 11 — Interruptibility
**Partial.** Mode-change morph interrupts prior transitions before starting. Reorder transitions interrupted at drag end. Gap: mid-morph interruption needs verification that D3 reads the current mid-tween DOM position correctly.

### Rule 12 — Visual cohesion
**Partial — gap.** Labels tween their own `transform` independently during settle. During cross-view morph, labels fade out/in (`'morph-label'`) rather than tracking the shape. Looks detached. Root cause: label position computed from target geometry, not interpolated from the shape's mid-tween `t`. Chosen approach: fade out early, fade in at destination (to be implemented).

### Rule 13 — Cross-view transitions

| From → To | Status |
|---|---|
| radial ↔ bands | ✅ `arcToRectReel` / `rectToArcReel` |
| bands ↔ treemap | ✅ `rectToRectScreen` |
| radial ↔ treemap | ✅ user verified |
| flat → hierarchical | ❌ hard cut — `HViz` is a separate component |
| within hierarchical | ❌ not implemented (ticket f289) |

Gap: color snaps at morph end (`.attr('fill')`) instead of being tweened.

### Rule 14 — Touch parity
**Partial.** Touch drag fixed this branch. Resize handle hit targets may be undersized for touch. Hover-reveal has no touch equivalent — handle discoverability on touch not audited.

### Rule 15 — Value edits scale live; order freezes during gesture
**✅ Implemented.** Scale updates live during value edits (Rule 2 keeps the mark under the pointer). `DataViewController` freezes only the displayed order during `Gesturing`; `settle()` is driven by the view's transition mechanism. Radial rebalancing remains the acceptable exception per rule.

### Rule 16 — Zoom-to-fit
**❌ Not implemented.** Layout fills SVG container statically. No animated bounds adjustment on commit.

### Rule 17 — Hierarchical parity
**❌ Significant gap.** No cross-mode transitions within hierarchical modes. Drill is a hard cut in h-treemap. Multi-level display incomplete. See ticket f289.

---

## Open questions

- **Treemap DM**: how does direct manipulation work on a treemap? Resize via drag corner/edge? Reorder via drag to new position? Not yet designed.
- **Radial resize live rebalance**: other slices moving live during drag — currently accepted as the radial exception. Revisit if it feels disorienting in practice.

---

*References: Shneiderman (1983), Hutchins/Hollan/Norman (1985), Bret Victor — Magic Ink (2006). See also tickets [4c6d] and [10b7].*
