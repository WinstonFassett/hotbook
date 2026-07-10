// DrillBreadcrumb — reusable HTML breadcrumb rendered into the chart element's
// chrome layer. Driven by drillNodeId + the tree root. One implementation,
// used by every hierarchical chart (treemap, pack, sunburst, icicle).
//
// This lives INSIDE the chart custom element (in the chrome layer above the
// SVG), not in the sliceboard container and not duplicated per-demo. Fixes
// WIN-190: the breadcrumb appears immediately on drill because the chart
// owns it and reacts to its own drillNodeId cell — no round-trip through
// hudStore, no container add-vs-replace bug.

import { derive, effect as biEffect } from "bireactive";
import type { BiNode } from "./tree";
import { buildParentIndex } from "./tree";

export interface DrillBreadcrumbOpts {
  /** The chart's reactive drill id cell — breadcrumb tracks this. */
  drillIdCell: { value: string | null };
  /** The tree root — used to walk the ancestor path. */
  root: BiNode;
  /** The chrome layer element to render the breadcrumb into. */
  chromeLayer: HTMLElement;
  /** Called when the user clicks a crumb. `null` = drill out to root. */
  onDrill: (id: string | null) => void;
}

/**
 * Mount a drill breadcrumb into the chart's chrome layer. Returns a disposer.
 * The breadcrumb is reactive — it rebuilds whenever drillIdCell changes.
 */
export function mountDrillBreadcrumb(opts: DrillBreadcrumbOpts): () => void {
  const { drillIdCell, root, chromeLayer, onDrill } = opts;
  let bar: HTMLElement | null = null;
  let parentIdx = buildParentIndex(root);

  const pathDerive = derive(() => {
    const id = drillIdCell.value;
    if (!id) return [] as BiNode[];
    // Walk from the drilled node up to root.
    const node = findNodeById(root, id);
    if (!node) return [];
    const path: BiNode[] = [];
    let cur: BiNode | undefined = node;
    while (cur) {
      path.unshift(cur);
      cur = parentIdx.get(cur);
    }
    return path;
  });

  const unsub = biEffect(() => {
    const path = pathDerive.value;
    // Remove old bar
    if (bar) {
      bar.remove();
      bar = null;
    }
    if (path.length === 0) return;

    bar = buildBar(path, onDrill);
    chromeLayer.appendChild(bar);
  });

  return () => {
    unsub();
    if (bar) bar.remove();
  };
}

function findNodeById(root: BiNode, id: string): BiNode | null {
  if (root.value.id === id) return root;
  for (const child of root.children) {
    const found = findNodeById(child as BiNode, id);
    if (found) return found;
  }
  return null;
}

function buildBar(path: BiNode[], onDrill: (id: string | null) => void): HTMLElement {
  const bar = document.createElement("nav");
  bar.className = "drill-breadcrumb";
  bar.setAttribute("role", "navigation");
  bar.setAttribute("aria-label", "Drill path");

  // Root button
  const rootBtn = document.createElement("button");
  rootBtn.type = "button";
  rootBtn.className = "drill-crumb drill-crumb--root";
  rootBtn.textContent = "Root";
  rootBtn.addEventListener("click", () => onDrill(null));
  bar.appendChild(rootBtn);

  // Path segments — skip the root node (index 0) since the Root button covers it.
  const segments = path.slice(1);
  segments.forEach((node, i) => {
    const isCurrent = i === segments.length - 1;

    const sep = document.createElement("span");
    sep.className = "drill-sep";
    sep.textContent = "›";
    bar.appendChild(sep);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `drill-crumb${isCurrent ? " drill-crumb--current" : ""}`;
    btn.textContent = node.value.label;
    if (isCurrent) btn.setAttribute("aria-current", "location");
    btn.addEventListener("click", () => onDrill(isCurrent ? null : node.value.id));
    bar.appendChild(btn);
  });

  return bar;
}
