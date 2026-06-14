import { Diagram } from "bireactive";
import { MdPack } from "./demos/pack";
import { MdTreemapLC } from "./demos/treemap";
import { MdIcicleLC } from "./demos/icicle";
import { MdSunburstLC } from "./demos/sunburst";
import { MdLineChartLC } from "./demos/line-chart";
import { MdAreaChartLC } from "./demos/area-chart";

const experiments: Array<{ id: string; title: string; tag: string; ctor: typeof Diagram }> = [
  { id: "line-chart", title: "LineChart (Cartesian port, v1)", tag: "v-line-chart", ctor: MdLineChartLC },
  { id: "area-chart", title: "AreaChart (Cartesian port, v1)", tag: "v-area-chart", ctor: MdAreaChartLC },
  { id: "pack", title: "Pack (circle packing)", tag: "v-pack", ctor: MdPack },
  { id: "treemap", title: "Treemap (squarified)", tag: "v-treemap", ctor: MdTreemapLC },
  { id: "icicle", title: "Icicle (Partition vertical)", tag: "v-icicle", ctor: MdIcicleLC },
  { id: "sunburst", title: "Sunburst (Partition polar)", tag: "v-sunburst", ctor: MdSunburstLC },
];

for (const e of experiments) {
  if (!customElements.get(e.tag)) customElements.define(e.tag, e.ctor as any);
}

const app = document.getElementById("app");
if (app) {
  for (const e of experiments) {
    const section = document.createElement("section");
    section.id = e.id;
    section.className = "experiment";
    const h2 = document.createElement("h2");
    h2.textContent = e.title;
    const demo = document.createElement("div");
    demo.className = "demo";
    demo.appendChild(document.createElement(e.tag));
    section.append(h2, demo);
    app.appendChild(section);
  }
}
