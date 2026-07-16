import { DataView, VfIcicle, VfSideTable } from "@hotbook/vizform";
import type { VizNode } from "@hotbook/core";

const sampleNodes: VizNode[] = [
  { id: "a", parentId: null, index: 0, name: "Root A", measures: { value: 0 }, dims: {} },
  { id: "a1", parentId: "a", index: 0, name: "A-1", measures: { value: 40 }, dims: {} },
  { id: "a2", parentId: "a", index: 1, name: "A-2", measures: { value: 30 }, dims: {} },
  { id: "a3", parentId: "a", index: 2, name: "A-3", measures: { value: 20 }, dims: {} },
  { id: "b", parentId: null, index: 1, name: "Root B", measures: { value: 0 }, dims: {} },
  { id: "b1", parentId: "b", index: 0, name: "B-1", measures: { value: 25 }, dims: {} },
  { id: "b2", parentId: "b", index: 1, name: "B-2", measures: { value: 15 }, dims: {} },
  { id: "b1a", parentId: "b1", index: 0, name: "B-1-a", measures: { value: 10 }, dims: {} },
  { id: "b1b", parentId: "b1", index: 1, name: "B-1-b", measures: { value: 15 }, dims: {} },
];

const dataView = new DataView(sampleNodes);

dataView.updateConfig({
  measure: "value",
  sort: "index",
  depth: 4,
  orientation: "vertical",
  canReorder: false,
});

const icicle = new VfIcicle();
icicle.style.cssText = "flex:1 1 auto;min-height:300px;border:1px solid #ccc;";
icicle.setDataView(dataView);

const table = new VfSideTable();
table.style.cssText = "flex:0 0 300px;overflow:auto;border-left:1px solid #ccc;";
table.setDataView(dataView);

const chartWrap = document.createElement("div");
chartWrap.style.cssText = "display:flex;flex:1 1 auto;overflow:hidden;";
chartWrap.appendChild(icicle);
chartWrap.appendChild(table);

const controls = document.createElement("div");
controls.style.cssText = "display:flex;gap:1rem;padding:0.5rem;align-items:center;";

function makeSelect(label: string, values: string[], current: string, onChange: (v: string) => void) {
  const wrap = document.createElement("label");
  wrap.style.cssText = "display:flex;align-items:center;gap:0.5rem;";
  wrap.textContent = label;
  const sel = document.createElement("select");
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    if (v === current) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => onChange(sel.value));
  wrap.appendChild(sel);
  return wrap;
}

controls.appendChild(
  makeSelect("measure", ["value"], "value", (v) => dataView.updateConfig({ measure: v }))
);
controls.appendChild(
  makeSelect("sort", ["index", "value"], "index", (v) => dataView.updateConfig({ sort: v as "index" | "value" }))
);
controls.appendChild(
  makeSelect("orientation", ["vertical", "horizontal"], "vertical", (v) => dataView.updateConfig({ orientation: v as "vertical" | "horizontal" }))
);
controls.appendChild(
  makeSelect("depth", ["1", "2", "3", "4"], "4", (v) => dataView.updateConfig({ depth: Number(v) }))
);

const resetBtn = document.createElement("button");
resetBtn.textContent = "Reset data";
resetBtn.addEventListener("click", () => dataView.update(sampleNodes));
controls.appendChild(resetBtn);

const root = document.createElement("div");
root.style.cssText = "display:flex;flex-direction:column;height:100vh;";
root.appendChild(controls);
root.appendChild(chartWrap);

document.body.style.margin = "0";
document.body.appendChild(root);
