// bireactive-viz — DM-enabled hierarchical viz kit built on the LayerChart
// vocabulary (Treemap, Partition, Pack, Tree, Sankey) but with bireactive
// owning identity, reactivity, gestures, and lens write-back.
//
// Ticket ba98 — first milestone: treemap with chart-context + drill-in (R16).

import { Diagram } from "bireactive";
import { MdTreemap } from "./demos/treemap";

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
