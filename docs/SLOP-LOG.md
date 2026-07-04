# SLOP LOG — vizform

Running catalog of "slop": code that looks plausible in source but is wrong, dead, inert, contradictory, or unverified against the running app. Winston's instruction (2026-07-04): "be on the lookout for slop... keep tracking the types and locations." Append findings here as they surface; each becomes a cleanup/fix task or feeds an existing sweep.

## Root pattern
Most of this comes from **code verified by reading the source, never by running it in the browser**. The fix-forward rule: every claimed behavior must be confirmed against the actual running app (Winston: "I want to SEE things"). The WIN-131 R2 harness is one instance of building that verification.

## Slop types (taxonomy — grows as we find more)
- **INERT-CSS** — CSS transition/animation applied to a property the browser can't animate (esp. SVG geometry ATTRIBUTES: x/y/width/height/d/r/cx/cy set via attr()). Looks like motion in source; does nothing live.
- **INVERTED-GATE** — a conditional that fires the wrong branch (e.g. animates exactly when it should write-through).
- **LYING-COMMENT** — a comment describing behavior the code doesn't/can't do.
- **PHANTOM-REQUIREMENT** — code/logic guarding a constraint that was never actually a requirement, or a whole-app intent misapplied per-component.
- **HALF-DONE-MARKED-DONE** — an issue closed/merged as complete that only addressed part of the problem.
- **SOURCE-AUDIT-OVERCOUNT** — an audit/scorecard derived from source that overstates real problems because it didn't check runtime behavior.

## Log

### 2026-07-04 — motion policy / R2 sweep (via WIN-131 harness)
| Type | Location | Detail | Disposition |
|---|---|---|---|
| INERT-CSS | bar-chart.ts ~:353,:399 (bar) & :658,:704 (bands) | `settleTransition(["y","height",...])` / width/x/cx on SVG rect+label ATTRIBUTES. Computed style shows the transition, but attrs don't CSS-animate — verified live: y/height jump straight to final, zero interpolation. NO visible lag. | WIN-129 downgraded to dead-code removal |
| INERT-CSS | gantt.ts :754 | `settleTransition(["x","width","fill"])` on tile x/width (SVG attrs) — inert. | part of WIN-129 area |
| INERT-CSS | sunburst.ts :297,:457 | `settleTransition("d")` / `("r")` on arc d + hub r (SVG attrs) — inert. | verify + strip, WIN-128 |
| INERT-CSS | concentric-arc.ts :241 | `style.transition = "d 0.1s"` on value arc `d` — no `d` in computed transitionProperty; inert. | WIN-130 downgraded to delete-dead-line |
| INVERTED-GATE + REAL lag | radar-chart.ts (pre-fix) | 250ms JS `tween` on spoke radius gated to fire when NOT gestureActive — i.e. animated exactly the remote case that must be immediate. This one was REAL (JS tween interpolates). | FIXED, PR #63 |
| LYING-COMMENT | radar-chart.ts (pre-fix) | comment "On sort, the datum at slot i changes — the tween morphs..." but radar has NO reorder (spoke order fixed by data array). The tween never served a reorder. | fixed w/ PR #63 |
| REAL lag (JS tween) | treemap.ts, pack.ts | manual `tween()` on x/y/w/h, cx/cy/r — JS interpolation, DOES lag on cross-tile edits. Harness: 6/6 early frames drift. | WIN-127 (real two-lane fix) |
| HALF-DONE-MARKED-DONE | WIN-94 (PR #40) | "direct manipulation transition lag" marked done; only suppressed settle during a chart's OWN gesture. Cross-tile case left unaddressed (though much of it turned out to be INERT-CSS anyway). | tracked WIN-126 |
| SOURCE-AUDIT-OVERCOUNT | docs/rebuild-tech-design.md Appendix C | R1–R5 scorecard was a SOURCE audit; over-counted R2 violations because it didn't check that SVG-attr CSS transitions are inert. Real violations are far fewer (JS-tween charts only). | reconcile Appendix C after sweep |

### (append future findings below)
