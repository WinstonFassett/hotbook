// bireactive-viz — DM-enabled hierarchical viz kit built on the LayerChart
// vocabulary (Treemap, Partition, Pack, Tree, Sankey) but with bireactive
// owning identity, reactivity, gestures, and lens write-back.
//
// Ticket ba98 — first milestone: treemap with chart-context + drill-in (R16).

import { Diagram } from "bireactive";
import { MdTreemap } from "./demos/treemap";
import { MdPack } from "./demos/pack";
import { MdPackDrill } from "./demos/pack-drill";
import { MdIcicle, MdSunburst } from "./demos/partition";
import { MdIcicleDrill, MdSunburstDrill } from "./demos/partition-drill";
import { MdTree } from "./demos/tree";

const experiments: Array<{
  id: string;
  title: string;
  note: string;
  tag: string;
  ctor: typeof Diagram;
}> = [
  {
    id: "treemap",
    title: "Treemap with drill-in (chart-context + focus domain)",
    note: "Port of LayerChart <Treemap> shape (d3-treemap layout, slot-yields-nodes pattern). Adds two things LayerChart can't do: (1) drag a leaf to reapportion via a sum-redistribute lens; (2) click a branch to drill in — the chart-context focus domain re-projects every tile through the new viewport. Esc to pop. Lands R16 for the hierarchical case.",
    tag: "v-treemap",
    ctor: MdTreemap,
  },
  {
    id: "pack",
    title: "Pack with drill-in (circle packing)",
    note: "Port of LayerChart <Pack> shape (d3-pack circle packing) following the treemap recipe: click a branch to drill in (focus zooms to the circle's bounding box), Esc to pop, drag a leaf to reapportion via the same sum-redistribute lens. Radius scales with sx since Pack is isotropic.",
    tag: "v-pack",
    ctor: MdPack,
  },
  {
    id: "icicle",
    title: "Icicle (Partition vertical) with drill-in",
    note: "Port of LayerChart <Partition> shape (d3-partition) in vertical/icicle orientation: each descendant rendered as a rect projected through ctx.focus. Click a branch to drill in (focus zooms to its layout rect), Esc to pop, drag a leaf to reapportion via the same sum-redistribute lens used by treemap/pack.",
    tag: "v-icicle",
    ctor: MdIcicle,
  },
  {
    id: "sunburst",
    title: "Sunburst (Partition polar) with drill-in",
    note: "Port of LayerChart <Partition> shape laid out polar: size=[2π, R], x0/x1 are angles and y0/y1 are radii. Rendered with bireactive's annularSector; ctx.focus is reused as a [angle, radius] window so drill-in zooms an arc to the full disc. Drag-to-reapportion deferred for first iteration; arrows/Alt+wheel edit leaf values.",
    tag: "v-sunburst",
    ctor: MdSunburst,
  },
  {
    id: "pack-drill",
    title: "Pack with drill-in (re-layout on subtree)",
    note: "Drill-in re-layouts the subtree to fill the viewport; Esc pops.",
    tag: "v-pack-drill",
    ctor: MdPackDrill,
  },
  {
    id: "icicle-drill",
    title: "Icicle with drill-in (re-layout on subtree)",
    note: "Drill-in re-layouts the subtree to fill the viewport; Esc pops.",
    tag: "v-icicle-drill",
    ctor: MdIcicleDrill,
  },
  {
    id: "sunburst-drill",
    title: "Sunburst with drill-in (re-layout on subtree)",
    note: "Drill-in re-layouts the subtree to fill the disc (no polar focus projection); Esc pops.",
    tag: "v-sunburst-drill",
    ctor: MdSunburstDrill,
  },
  {
    id: "tree",
    title: "Tree (node-link, horizontal) with expand/collapse",
    note: "Port of LayerChart <Tree> shape (d3-hierarchy tree layout). Links rendered as inline cubic Beziers (d3-shape isn't a workspace dep), nodes as small circles with labels. Click a branch to expand/collapse subtree; Shift+click to drill in to the subtree bounding box; Esc to pop.",
    tag: "v-tree",
    ctor: MdTree,
  },
];

for (const e of experiments) {
  if (!customElements.get(e.tag)) customElements.define(e.tag, e.ctor as any);
}

const app = document.getElementById("app");
if (app) {
  const toc = document.createElement("nav");
  toc.className = "toc";
  for (const e of experiments) {
    const a = document.createElement("a");
    a.href = `#${e.id}`;
    a.textContent = e.title;
    toc.appendChild(a);
  }
  app.parentElement?.insertBefore(toc, app);

  for (const e of experiments) {
    const section = document.createElement("section");
    section.className = "experiment";
    section.id = e.id;
    const h2 = document.createElement("h2");
    h2.textContent = e.title;
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = e.note;
    const demo = document.createElement("div");
    demo.className = "demo";
    const el = document.createElement(e.tag);
    demo.appendChild(el);
    section.append(h2, note, demo);
    app.appendChild(section);
  }
}
