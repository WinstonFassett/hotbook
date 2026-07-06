# AGENTS.md — vizform

## bireactive `rect()` overload gotcha

`rect(x, y, w, h, opts)` is corner-based (top-left). `rect(Vec, w, h, opts)` is **center-based** — the Vec is the center point, not the corner. Always pass x and y as separate values for corner positioning.
