# Dockview-class layout — behavioral spec

Working spec for the sliceboard "Splits" layout to grow into something in the
class of [dockview.dev](https://dockview.dev/) / VS Code editor groups. This
is the *behavioral* surface — what the user can do and what the layout
guarantees. Implementation choices (CSS Grid vs Flex, virtual DOM vs DOM
move, etc.) live in tickets, not here.

Out of scope for this doc: floating windows, persistence-across-sessions
beyond what the dashboard already does, theming.

---

## 0 · The mental model

The layout is a **tree of containers** whose leaves are **panels**. There is
exactly one root container. A container is one of:

- **Split** — fixed direction (`row` or `col`), N children, proportional
  sizing per child via flex weights, dividers between siblings. Children may
  be any container kind.
- **TabGroup** — N panels with one active. Tabs along one edge (top by
  default). Exactly one panel rendered at a time.
- **Panel** — a leaf. Carries a tile (or whatever the host wires up).

Today's `SplitNode` only has Split + Panel. Adding TabGroup is the next
structural step.

A pane the user sees on screen is *always a TabGroup with ≥1 panel*. A
single-panel TabGroup renders without a visible tab strip (matches VS Code's
"no tabs when only one editor" behavior, configurable).

---

## 1 · Operations on the tree (atomic, reversible)

Every operation below produces a new tree value; the old tree is the
undo target.

### 1.1 Split a panel/group
- **Inputs:** source group id, direction (`left|right|up|down`)
- **Effect:** the source group is replaced with a 2-child Split in the
  matching axis; the new sibling is an empty TabGroup ready to receive
  a panel.
- **Sizing:** new sibling gets the average weight of existing siblings (or
  50% if it's the first split).

### 1.2 Add panel to a group
- **Inputs:** target group id, panel, index (defaults to end)
- **Effect:** panel inserted into target group's panel list at index;
  becomes active.

### 1.3 Move panel between groups
- **Inputs:** panel id, target group id, index
- **Effect:** panel removed from source group, inserted at target. If source
  becomes empty, source group is removed and parent collapses (see 1.5).

### 1.4 Drop panel onto a panel edge (split-and-place)
- **Inputs:** panel id, target panel id, edge (`left|right|up|down`)
- **Effect:** target's group is split in the requested direction; the
  source panel lands in the new empty side. Equivalent to (1.1 with the
  target's parent group) then (1.3 into the new group).

### 1.5 Collapse rules (auto-tidy after removal)
- A Split with 1 surviving child is replaced by that child.
- A Split with 0 surviving children is removed from its parent.
- A TabGroup with 0 panels is removed from its parent (cascades to
  Split collapse).
- The root, if it collapses to nothing, becomes the empty state ("no
  panels — click '+ Panel'").

### 1.6 Resize divider
- **Inputs:** split id, gutter index, delta (px)
- **Effect:** the two adjacent children's weights are rebalanced
  proportional to delta within the pair's combined weight. Other siblings
  untouched.

### 1.7 Maximize / restore (deferred)
- Mark a group as "maximized." Render full-bleed over the surface until
  restored. Other groups remain in the tree; not removed.

---

## 2 · Drag-and-drop semantics

Dragging is the primary way users restructure the layout. Two drag sources:

- **Tab drag** — picked up from a tab. Source is one panel.
- **Group drag** — picked up from a group header (or the panel chrome when
  no tabs are shown). Source is a whole group.

For Phase A we ship **tab drag** only. Group drag can wait.

### 2.1 Drop targets and zones

The cursor hit-tests against the panel under the pointer. Each panel
defines five drop zones:

| Zone   | Geometry                          | Drop effect                                |
|--------|-----------------------------------|--------------------------------------------|
| Left   | Left 25% of panel rect            | Split the group horizontally, drop in new left sibling  |
| Right  | Right 25%                         | Split horizontally, drop in new right sibling           |
| Up     | Top 25%                           | Split vertically, drop in new top sibling               |
| Down   | Bottom 25%                        | Split vertically, drop in new bottom sibling            |
| Center | Inner 50% (the box left by edges) | Add to this group's tab list (at end, or at hovered tab index if dragging over the tab strip) |

The cursor's position selects exactly one zone — no ambiguity. Top/bottom
zones win over left/right when both could apply (corners go to the
vertical-axis edge), matching VS Code/dockview.

### 2.2 Visual feedback during drag

Per [interaction-principles §3](./interaction-principles.md) — real-time
preview is required:

- Each panel under the cursor shows a **drop indicator overlay** for the
  currently-hovered zone. Edge drops show a thick coloured bar pinned to
  that edge (full-height for left/right, full-width for up/down). Center
  drops shade the whole panel.
- The tab strip shows an **insertion caret** when the cursor is between
  two tabs.
- The dragged tab tracks the cursor as a floating ghost (or fades from its
  source position — implementation choice).

The operation does NOT mutate the tree during the drag — drag is
speculative until release (principle §6). Render the indicator, snapshot
on dragstart, commit on drop.

### 2.3 Cancel

`Esc` during a drag cancels. So does dropping outside any panel (the
whole surface is a no-op target). No partial tree mutation.

### 2.4 Constraints

- A panel cannot be dropped on itself if the resulting tree would equal
  the starting tree (no-op detected → cancel silently).
- A panel cannot be the only thing in a center-drop on its own group
  (same — no-op).

---

## 3 · Tabs

A TabGroup with >1 panel renders a tab strip.

- **Activation:** click a tab to make it active. Middle-click closes it.
  Active panel is the only one rendered (others are unmounted, or
  display:none — implementation choice; favour unmount to keep cost low).
- **Reorder within strip:** drag a tab horizontally over its siblings.
  Sibling tabs animate to make room. Drop commits the reorder.
- **Move to another group:** drag the tab onto another panel and use the
  drop zones from §2.1.
- **Close:** ✕ on hover (or middle-click). Removes the panel from the
  group. If the group becomes empty, collapse per §1.5.

Default new-pane behavior: when a Split creates an empty sibling (§1.1),
the next "+ Panel" lands in that sibling. A keyboard shortcut isn't
required for Phase A.

---

## 4 · Single-page vs multi-page surface

The user's open question: "is there a concept of a root view that is page
height by default, can be split, resized, and there could be other pages
below that?"

Two interpretations:

### Option A — One page, viewport-sized
- Root is always the single tree. The tree fills the available content
  area exactly. No vertical scroll on the layout itself; tiles that need
  scrolling do so internally.
- Pro: matches VS Code, dockview, every IDE-class tool. Simpler mental
  model. Layout decisions are local.
- Con: cannot mix "dashboard A above, dashboard B below" the way the
  user described.

### Option B — Stacked pages
- The surface is a *vertical stack* of pages. Each page is a separately
  rooted dockview tree, sized to viewport height by default but
  resizable along the inter-page gutter. Scroll the surface to move
  between pages.
- Each page is conceptually a Dashboard in today's model — so this is
  really "let me see multiple dashboards on one scroll surface."
- Pro: addresses the user's "too short" perception — they can stack
  more layouts vertically without one root tree turning into spaghetti.
  Gives a natural progression from "small layout" to "long-form report."
- Con: introduces two split contexts (intra-page docks vs inter-page
  page-stack). Has to feel different visually so the user knows which
  gutter does what.

### Recommendation

Ship **Option A** as the core dockview-class layout. It's the
better-understood pattern and the work is well-scoped. *Then* introduce
the page stack as an outer container that holds N dashboards in sequence —
which is essentially a new top-level concept independent of dockview, so
it doesn't muddy the dockview model. Today's "Dashboards" menu already
implies multiple dashboards per dataset; the page stack is "render them
inline instead of switching between them" and that decision can be made
later without disturbing the tree.

---

## 5 · Sizing & overflow

- The dockview root is exactly the size of its container — `100%` width
  and height, no overflow.
- Internal tile contents that exceed their cell scroll within the cell.
  Cells never overflow their split.
- Minimum cell sizes: each panel reserves a configurable min-width and
  min-height (default ~120×80px). A resize drag clamps against the
  smallest pair, never below the minimum.
- The dragged tab ghost is fixed-positioned and ignores layout flow.

The current "layout too short" perception is probably this: the splits
root renders at the natural height of `.sb-grid-wrap`, which is fine, but
when there are 2-3 panels in one horizontal row they each get ~tall ×
wide, so visually the surface feels squat. Real fix is *more density via
tabs and vertical splits* — which is the rest of this doc. Optional
near-term tweak: a "Fit to viewport" mode that explicitly pins root to
window height even on long pages.

---

## 6 · Persistence shape

Today: `Dashboard.splitTree?: SplitNode | null`. Migrate to:

```ts
type DockNode = DockSplit | DockGroup
interface DockSplit  { kind: 'split'; id: string; direction: 'row'|'col'; sizes: number[]; children: DockNode[] }
interface DockGroup  { kind: 'group'; id: string; panels: DockPanel[]; activeId: string }
interface DockPanel  { id: string; tileId: string }
```

- `id`s are stable per node (preserves React keys + lets us address nodes
  in operations).
- `sizes` are flex weights (unchanged from today).
- `activeId` references one of `panels[].id`.
- Reconcile against the canonical Tile list as today: drop panels whose
  tileId is gone; new tiles added by the topbar "+ Tile" go into a
  designated "scratch" group (last-touched group, falling back to root's
  first group).

Storage key bumps to v12 with a one-shot migration: every existing
`SplitNode` leaf becomes a single-panel `DockGroup` in the same position.
Existing `split` branches keep their shape.

---

## 7 · What ships when (suggested phasing)

### Phase A — Tabs + edge-drop (the core dockview gesture)
- Migrate persistence to `DockNode` (§6).
- TabGroup rendering with click-to-activate + middle-click-close.
- Tab drag with the five drop zones (§2.1) and live drop indicators (§2.2).
- Tab reorder within a strip.
- Per-pane split buttons stay; they delegate to (§1.1) + (§1.2).

### Phase B — Polish
- Group drag (move a whole group, not just a tab).
- Keyboard: Ctrl+\ split right, Ctrl+K Ctrl+\ split down (VS Code parity).
- Maximize/restore (§1.7).
- Saved layout presets per dashboard.

### Phase C — Multi-page surface (Option B)
- Vertical page stack of dockview roots.
- Inter-page gutter and "Add page below."
- Whether to keep this in sliceboard or extract a `@winstonfassett/dock`
  package — decide once Phase A is committed and the API is real.

---

## 8 · References

- [dockview.dev](https://dockview.dev/) — the comparison point. Behavior to
  match: edge drop zones, tab strip with caret, group drag, floating
  windows (deferred for us), maximize.
- VS Code editor groups — same behavior class. Notable: VS Code hides the
  tab strip when only one tab is in a group (default).
- Mitchell Hashimoto's tweet referenced in WIN-57 — a working
  demonstration of the gestures we want.

---

## 9 · Open questions

1. Do we want a **floating** drag preview (panel detaches from layout, lives
   over a portal) or **placeholder** drag (panel hides + ghost in its
   place)? Floating is what dockview does and feels nicer; placeholder is
   simpler.
2. Does "+ Tile" in the topbar still make sense in dockview mode, or is
   every tile added via a per-pane "+ Panel" affordance? VS Code goes the
   second way (you add files into a group, never globally).
3. When the user enters Splits mode for the first time, do we want the
   seed layout or an empty single panel they grow from? VS Code answers
   "single empty editor on first launch" — that's a stronger default.
4. Does TabGroup's tab strip need overflow behavior (scroll, dropdown)
   on Phase A, or can we defer that until panels-per-group routinely
   exceeds ~6?
