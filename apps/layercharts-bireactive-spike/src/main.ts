import { Diagram } from "bireactive";
import { MdPack } from "./demos/pack";
import { MdTreemapLC } from "./demos/treemap";
import { MdIcicleLC } from "./demos/icicle";
import { MdSunburstLC } from "./demos/sunburst";
import { MdLineChartLC } from "./demos/line-chart";
import { MdAreaChartLC } from "./demos/area-chart";
import { MdBarChartLC } from "./demos/bar-chart";
import { MdScatterChartLC } from "./demos/scatter-chart";
import { MdPieChartLC } from "./demos/pie-chart";
import { MdRadarChartLC } from "./demos/radar-chart";
import { MdConcentricArcLC } from "./demos/concentric-arc";

const experiments: Array<{ id: string; title: string; tag: string; ctor: typeof Diagram }> = [
  { id: "line-chart", title: "LineChart", tag: "v-line-chart", ctor: MdLineChartLC },
  { id: "area-chart", title: "AreaChart", tag: "v-area-chart", ctor: MdAreaChartLC },
  { id: "bar-chart", title: "BarChart", tag: "v-bar-chart", ctor: MdBarChartLC },
  { id: "scatter-chart", title: "ScatterChart", tag: "v-scatter-chart", ctor: MdScatterChartLC },
  { id: "pie-chart", title: "PieChart", tag: "v-pie-chart", ctor: MdPieChartLC },
  { id: "radar-chart", title: "RadarChart (Radial Line)", tag: "v-radar-chart", ctor: MdRadarChartLC },
  { id: "concentric-arc", title: "ConcentricArc", tag: "v-concentric-arc", ctor: MdConcentricArcLC },
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
