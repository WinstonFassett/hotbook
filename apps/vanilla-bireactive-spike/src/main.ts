// Bireactive spike — see ticket ba98.
// Each <m-*> element below is a `Diagram` subclass; they self-register
// on import via `Diagram.define()`.

import { Diagram } from "bireactive";

import { MdBudgetTree } from "./elements/budget-tree";
import { MdBboxHandles } from "./elements/bbox-handles";
import { MdAnchors } from "./elements/anchors";
import { MdAllen } from "./elements/allen";
import { MdChoreography } from "./elements/choreography";
import { MdProportional } from "./elements/proportional";
import { MdCrossView } from "./elements/cross-view";
import { MdGantt } from "./elements/gantt";
import { MdTreemap } from "./elements/treemap";
import { MdSunburst } from "./elements/sunburst";
import { MdIcicle } from "./elements/icicle";
import { MdLayoutPicker } from "./elements/layout-picker";
import { MdDag } from "./elements/dag";

type Section = "viz" | "lab";

const experiments: Array<{
  id: string;
  title: string;
  note: string;
  tag: string;
  ctor: typeof Diagram;
  section: Section;
}> = [
  // === Viz: direct manipulation of data visualizations (the target) ===
  {
    id: "proportional",
    title: "Proportional bars (sums to total)",
    note: "Original. Three live views of one Cell<Num[]>: vertical bars, stacked bar, pie. Drag any boundary in any view; the others stay in sync via a sum-redistribute lens. Focus a bar and use arrow keys (±1, shift ±5) or alt+wheel to scrub.",
    tag: "m-proportional",
    ctor: MdProportional,
    section: "viz",
  },
  {
    id: "treemap",
    title: "Treemap (squarified, writable tree)",
    note: "Original. Forward layout: d3.treemap with squarified tile (Bruls et al.), source-order preserved so tiles don't reorder during edits. Backward: bireactive sum-redistribute lens on the writable Num leaves. Focus a leaf tile and nudge with arrows / alt+wheel; siblings absorb proportionally, parent totals invariant.",
    tag: "m-treemap",
    ctor: MdTreemap,
    section: "viz",
  },
  {
    id: "sunburst",
    title: "Sunburst (hierarchical radial, writable tree)",
    note: "Original. Forward layout: d3.partition over the same writable tree as treemap — rings = depth, wedge angle ∝ value. Backward: nudge any wedge with arrows / alt+wheel; next sibling absorbs. Per vizform Rule 15 (radial exception), other slices rebalance live during the gesture — proportion IS the coordinate.",
    tag: "m-sunburst",
    ctor: MdSunburst,
    section: "viz",
  },
  {
    id: "icicle",
    title: "Icicle (hierarchical bands, writable tree)",
    note: "Original. The cartesian sibling of sunburst — same writable tree, d3.partition over a linear x-extent: rows = depth, row width ∝ value. Backward: same sum-redistribute lens. Arrow keys / alt+wheel to nudge; next sibling absorbs.",
    tag: "m-icicle",
    ctor: MdIcicle,
    section: "viz",
  },
  {
    id: "budget-tree",
    title: "Budget tree (hierarchical, redistribute on drag)",
    note: "Ported from upstream `md-budget-tree`. Sum aggregates at each non-leaf: read = Σchildren, write = redistribute proportionally. Drag a boundary at any level. The bireactive answer to h-treemap drill.",
    tag: "m-budget-tree",
    ctor: MdBudgetTree,
    section: "viz",
  },
  {
    id: "dag",
    title: "DAG (relational, force-style relaxation)",
    note: "Original. A small social graph with edge springs + all-pairs repulsion + weak center gravity, relaxing each frame. Drag any node — it pins while held, releases on pointerup. No enforced hierarchy: the graph finds its own balance.",
    tag: "m-dag",
    ctor: MdDag,
    section: "viz",
  },
  {
    id: "layout-picker",
    title: "Layered DAG (Sugiyama-ish, with switchable algorithms)",
    note: "Original. A CI pipeline DAG laid out hierarchically by depth. Pick Layered ↓ (top-down), Layered → (left-to-right), Radial (depth = radius, source at center), or Grid. Node positions tween between layouts. Drag any node to override; edges follow live.",
    tag: "m-layout-picker",
    ctor: MdLayoutPicker,
    section: "viz",
  },
  {
    id: "cross-view",
    title: "Cross-view morph: one source, two lenses (bands ⇌ radial)",
    note: "Original. A single source with two lensed geometries. Slider interpolates t between bands (t=0) and radial (t=1). Labels track the centroid of the morphing shape — tests vizform Rule 12 (label cohesion) end-to-end.",
    tag: "m-cross-view",
    ctor: MdCrossView,
    section: "viz",
  },
  {
    id: "gantt",
    title: "Gantt with cascading dependencies",
    note: "Original. Tasks as writable Range cells; finish-to-start + lag enforced after each drag/keypress. Pushing one task cascades downstream successors through topo order. Drag bar body to slide, endpoints to resize. Arrow keys ±1d (shift ±7d), alt+wheel to scrub.",
    tag: "m-gantt",
    ctor: MdGantt,
    section: "viz",
  },
  {
    id: "allen",
    title: "Allen interval algebra (Gantt math)",
    note: "Ported from upstream `md-allen`. Two ranges A and B; the relation `A R B` is a writable cell. Drag bars or click a chip; B reshapes canonically. The math under any Gantt with dependency constraints.",
    tag: "m-allen",
    ctor: MdAllen,
    section: "viz",
  },

  // === Lab: bireactive primitives that aren't data-viz DM ===
  // Kept for reference / future borrowing; collapsed below.
  {
    id: "bbox-handles",
    title: "Lab · bounding-box handles (multi-parent lens)",
    note: "`bbox(points)` returns `{center, size}`; drag any point, center, or the red corner. Reference for multi-parent aggregate lenses.",
    tag: "m-bbox-handles",
    ctor: MdBboxHandles,
    section: "lab",
  },
  {
    id: "anchors",
    title: "Lab · writable anchors (rotate × scale composes)",
    note: "`r.at(u,v)` / `r.top` / `r.right` track rotation and scale automatically. Reference for the anchor system.",
    tag: "m-anchors",
    ctor: MdAnchors,
    section: "lab",
  },
  {
    id: "choreography",
    title: "Lab · rigid choreography (centroid · similarity transforms)",
    note: "centroid / meanRotation / meanScale aggregates animated in parallel. Reference for the animation runtime as an alternative to d3-transition.",
    tag: "m-choreography",
    ctor: MdChoreography,
    section: "lab",
  },
];

// Define custom elements once.
for (const e of experiments) {
  // bireactive's Diagram.define keys off the class name; we re-tag by hand.
  if (!customElements.get(e.tag)) customElements.define(e.tag, e.ctor as any);
}

const app = document.getElementById("app")!;

// TOC — viz section only; lab is collapsed at the bottom.
const toc = document.createElement("nav");
toc.className = "toc";
for (const e of experiments.filter(x => x.section === "viz")) {
  const a = document.createElement("a");
  a.href = `#${e.id}`;
  a.textContent = e.title.split(" (")[0]!;
  toc.appendChild(a);
}
document.body.insertBefore(toc, app);

function mountSection(e: (typeof experiments)[number]) {
  const sec = document.createElement("section");
  sec.className = "experiment";
  sec.id = e.id;
  const h = document.createElement("h2");
  h.textContent = e.title;
  const p = document.createElement("p");
  p.className = "note";
  p.textContent = e.note;
  const demo = document.createElement("div");
  demo.className = "demo";
  const el = document.createElement(e.tag);
  demo.appendChild(el);
  sec.append(h, p, demo);
  return sec;
}

// Viz first, in document order.
for (const e of experiments.filter(x => x.section === "viz")) {
  app.appendChild(mountSection(e));
}

// Lab section in a <details> — present but collapsed by default.
const lab = experiments.filter(x => x.section === "lab");
if (lab.length) {
  const labWrap = document.createElement("details");
  labWrap.className = "lab-wrap";
  const sum = document.createElement("summary");
  sum.textContent = `Lab — bireactive primitives (${lab.length}) — not data-viz, kept for reference`;
  labWrap.appendChild(sum);
  for (const e of lab) labWrap.appendChild(mountSection(e));
  app.appendChild(labWrap);
}
