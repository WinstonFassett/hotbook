# CLAUDE.md — hotbook

package manager: npm

do not use tsc or npm run build unless asked. prefer live developmet and browser testing.

- **Stash, never reset.** Never run destructive git that discards uncommitted edits. Use `git stash`.
- **Read the docs first.** `wiki/interaction-principles.md` and the memory files already have the answers. Read them before designing or touching gestures/sort/reorder.
- also see AGENTS.md

This is effectively a cross-framework component library with an experimental app and demos.
Consider principles of good component architecture. But this is NOT a React-style library. It uses fine-grained reactivity, ie `bireactive` which React tends to fight. Don't mixup the approaches.
Prefer decoupling through interfaces to heavy handed spaghetti code 
Prefer consumer ie pubsub event oriented architecture over imperative control.

## bireactive `rect()` overload gotcha

`rect(x, y, w, h, opts)` is corner-based (top-left). `rect(Vec, w, h, opts)` is **center-based** — the Vec is the center point, not the corner. Always pass x and y as separate values for corner positioning.
