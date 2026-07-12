# Super Split Pattern Research — WIN-158

**Status:** Research spike
**Date:** 2026-07-11
**Output:** Decision doc for split-oriented, animation-first tab UX

---

## Executive Summary

The "Super Split" pattern refers to a modern approach to split pane layouts pioneered by **Mitchell Hashimoto's split framework** and exemplified by **Replit Splits**. It differs from traditional IDE drag-drop in three key ways:

1. **Split-oriented** — Splitting is the primary action; tabs are secondary
2. **Animation-oriented** — Spring physics and 120fps animations; every transition feels intentional
3. **Remote-control** — Programmatic/keyboard tab moves, not just mouse drag

**Recommendation:** Adopt the animation and split-oriented principles while keeping dockview.dev's drag-drop foundation. Spring transitions and keyboard commands are the key gaps to close.

---

## Research Findings

### 1. Mitchell Hashimoto's Split Framework

Mitchell Hashimoto (creator of Ghostty terminal, Vagrant, Terraform) has been developing a split layout framework for Apple platforms with these characteristics:

- **"Every frame perfect" animation** — Built with SwiftUI + raw CoreAnimation
- **Spring physics** — Natural, physics-based motion for all transitions
- **Split-first workflow** — Focus on keyboard-driven splitting and navigation
- **libghostty foundation** — The split engine is being extracted into a reusable library

**Key insight:** The visual polish comes from treating animations as a first-class requirement, not an afterthought. Transitions use spring physics and run at native refresh rates.

**Sources:**
- [Mitchell Hashimoto tweet on split layout](https://x.com/mitchellh/status/2070273858154987537)
- [Mitchell on vertical tabs and terminal workflows](https://x.com/mitchellh/status/2024913161238053296)

### 2. Replit Splits — Production Implementation

Replit's Splits feature demonstrates the pattern in production:

**Animation philosophy:**
> "When panes automatically resize or insert, they animate into place, and when put together, these things might not even be noticeable, but that's the point: make it feel like the workspace understands your intent."

**Technical approach:**
- **Custom low-level implementation** — No pre-built grid libraries; wrote custom mouse-event handlers for full control over sensitivity and animation
- **Performance optimization** — Uses jotai to deliberately skip rerenders during drag state updates
- **Tab vs Pane semantics** — When dragging a tab, only the tab moves; when only one tab remains, it becomes a handle for the entire pane
- **Drop zones** — Drag onto quadrants to split; drag into header to merge tabs

**Key insight:** The smoothness comes from separating drag state management from React's render cycle and writing low-level mouse handlers.

**Sources:**
- [Replit — Fluid layout customization with Splits](https://blog.replit.com/splits)
- [Replit — A Tale of Two Tabs](https://blog.replit.com/tabs)

### 3. Dockview.dev Evolution

Dockview.dev 4.0.0 introduced:
- **New dnd overlay model** — Improved animations and customization
- **Tab animation controls** — Configurable tab reorder animations
- **Floating panels and popouts** — Advanced features for complex layouts

**Key insight:** Dockview provides the structural foundation (groups, splits, tabs) but leaves animation quality as an implementation detail.

**Sources:**
- [Dockview Examples](https://dockview.dev/examples/)
- [Dockview 4.0.0 Release](https://dockview.dev/blog/dockview-4.0.0-release/)

### 4. "Remote Control" Pattern

Found in terminal emulators (kitty, Warp) and native apps (Bonsplit):

**Programmatic control:**
- Jump to tab by name
- Send commands to specific panes
- Split and run commands in new panes
- Keyboard-driven navigation

**Animation quality:**
- **Bonsplit:** 120fps animations, native macOS tab bar
- **Warp:** Drag pane headers to reorder; animate insertions

**Key insight:** "Remote control" means tabs/panes are addressable and controllable via API and keyboard, not just mouse.

**Sources:**
- [Mastering kitty terminal](https://paul-nameless.com/mastering-kitty.html)
- [Bonsplit - Native macOS Split Panes](https://bonsplit.alasdairmonk.com/)
- [Warp Split Panes](https://docs.warp.dev/terminal/windows/split-panes/)

---

## Pattern Comparison

| Aspect | Old IDE Drag-Drop | Super Split Pattern |
|--------|------------------|---------------------|
| **Primary action** | Drag tab to zone | Keyboard split command |
| **Animation** | CSS transition or none | Spring physics, 120fps |
| **Tab control** | Mouse drag only | Mouse + keyboard + API |
| **Feel** | Mechanical, discrete | Fluid, intentional |
| **Drop feedback** | Static overlay zones | Animated preview |
| **Implementation** | High-level grid library | Custom low-level handlers |

---

## Recommendations for vizform/hotbook

### Adopt ✅

1. **Spring-animated transitions** for all layout changes (split, merge, resize, tab move)
   - Use CSS spring easing or JavaScript spring physics
   - Target 120fps (or match display refresh rate)
   - Respect `prefers-reduced-motion` per interaction-principles.md Rule 9

2. **Split-first keyboard shortcuts**
   - `Ctrl+\` — split right (VS Code parity)
   - `Ctrl+K Ctrl+\` — split down
   - `Ctrl+W` — close active panel
   - `Ctrl+1/2/3/...` — jump to panel N

3. **Animated drop zones**
   - Current spec has static 25% edge zones
   - Add: zone expands/highlights with spring animation as cursor enters
   - Add: preview where the tab will land (ghost pane outline)

4. **Tab/pane semantic distinction**
   - When 1 tab in group: dragging tab = drag whole pane (Replit behavior)
   - When >1 tab: dragging tab extracts just that tab

5. **Programmatic API** for layout control
   ```ts
   dockview.split(panelId, 'right')
   dockview.moveTab(tabId, targetGroupId, index)
   dockview.focusPanel(panelId)
   ```

### Keep from current spec ✅

1. **Dockview.dev foundation** — The tree model (Split/Group/Panel) is solid
2. **Five-zone drop targets** — Edge zones + center is proven UX
3. **Tab strip with reorder** — Standard pattern, works well
4. **Atomic operations** — The operation list in dockview-spec §1 is good

### Defer ⏸️

1. **Low-level mouse handlers** — Replit's approach makes sense for their monorepo; we can achieve smooth animations with careful CSS/spring tuning without abandoning React/Svelte
2. **Floating windows** — Already deferred in current spec
3. **libghostty adoption** — Interesting but Apple-platform only; not portable

---

## Spec Updates Required

Update `wiki/dockview-spec.md` with:

1. **§2.2 Visual feedback** — Add spring animation requirements
2. **§4 Good mechanics** (new section) — Reference interaction-principles.md Rule 4; specify spring easing
3. **§7 Phase A** — Add keyboard shortcuts to core deliverable
4. **§7 Phase B** — Add programmatic API
5. **§9 Open questions** — Add Q5: "Do we use CSS spring easing or JS spring library?"

---

## Decision: Animation Strategy

**Question:** How do we achieve 120fps spring animations in a React/Svelte context?

**Options:**

**A. CSS spring easing** (via custom cubic-bezier or `linear()`)
- ✅ Native performance, no JS overhead
- ✅ Works with existing React/Svelte patterns
- ❌ Limited control over spring physics parameters
- ❌ Can't interrupt mid-transition cleanly

**B. JavaScript spring library** (e.g., `react-spring`, `@motionone/solid`, `svelte/motion`)
- ✅ Full control over spring physics (mass, tension, friction)
- ✅ Interruptible at any frame (interaction-principles.md Rule 11)
- ✅ Can sync multiple properties (position + size + opacity)
- ❌ Requires library dependency
- ❌ More complex state management

**C. Web Animations API** with custom spring keyframes
- ✅ Native browser API, no library
- ✅ Better performance than RAF loops
- ❌ Spring physics requires manual keyframe generation
- ❌ Browser support varies

**Recommendation:** **Option B — JavaScript spring library**

**Rationale:**
- vizform/hotbook already depends on complex reactive libraries (bireactive, potential matchina)
- Spring interruptibility is critical per interaction-principles.md Rule 11
- Full control over physics parameters lets us match the "Super Split" feel
- Library choice can be backend-specific (react-spring for React surfaces, svelte/motion for Svelte, etc.)

**Implementation note:** The spring should live in `flexblox-dock` (per flexblox-design.md §2), not in individual charts. Dock owns layout transitions.

---

## Next Steps

1. ✅ **This doc** — Research findings captured
2. **Update `wiki/dockview-spec.md`** — Add animation requirements, keyboard shortcuts, programmatic API
3. **Spike: Spring animation PoC** — Test JS spring library with simple split/merge
4. **Decide: Adopt dockview-core or build custom?** — WIN-111's open question; spring transitions may tip the scale toward custom

---

## References

### Inspiration
- Mitchell Hashimoto's split layout framework (Twitter/X demonstrations)
- [Replit Splits](https://blog.replit.com/splits)
- [Dockview.dev demos](https://dockview.dev/examples/)

### Current vizform docs
- `wiki/dockview-spec.md` — Behavioral spec for dockview-class layout
- `wiki/interaction-principles.md` — 17 design rules (especially Rules 3, 4, 11)
- `wiki/flexblox-design.md` — Architecture; "supersplit-style" mentioned in §12

### Related tools
- [Bonsplit](https://bonsplit.alasdairmonk.com/) — Native macOS split panes, 120fps
- [kitty terminal](https://paul-nameless.com/mastering-kitty.html) — Remote control pattern
- [Warp terminal split panes](https://docs.warp.dev/terminal/windows/split-panes/)
