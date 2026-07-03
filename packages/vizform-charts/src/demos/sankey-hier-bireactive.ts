// Bireactive hierarchical sankey (WIN-56)
//
// Pattern: Root cells for visible flows + one big derive() for all geometry.
// Conservation is structural (impossible to violate).
//
// Key difference from sankey-flow: topology is DYNAMIC (changes on collapse/expand),
// so we rebuild the scene when collapsed set changes.

import { Anchor, Diagram, cell, circle, derive, label, pathD, rect, Vec, type Mount, type Num, type Writable, num } from "bireactive";
import { interpolateCool } from "d3-scale-chromatic";
import { dragCancelable } from "../lib/esc-contract";
import { flattenHierarchy, type HierNode, type HierLink } from "../lib/sankey-hier";
import { buildTopology, ribbonPath, computeLayout, type SankeyTopology, type SankeyLayout } from "../lib/sankey-layout";

// Sample hierarchy data (same as current MdSankeyHier)
const HIER_NODES: HierNode[] = [
  { id: "Americas" }, { id: "Europe" }, { id: "Asia" },
  { id: "USA", parent: "Americas" },
  { id: "Brazil", parent: "Americas" },
  { id: "Germany", parent: "Europe" },
  { id: "France", parent: "Europe" },
  { id: "China", parent: "Asia" },
  { id: "Japan", parent: "Asia" },
  { id: "Energy" }, { id: "Tech" }, { id: "Food" },
  { id: "Oil", parent: "Energy" },
  { id: "Renewables", parent: "Energy" },
  { id: "Hardware", parent: "Tech" },
  { id: "Software", parent: "Tech" },
  { id: "Grain", parent: "Food" },
  { id: "Meat", parent: "Food" },
];

const HIER_LINKS: HierLink[] = [
  { source: "USA", target: "Oil", value: 12 },
  { source: "USA", target: "Hardware", value: 18 },
  { source: "USA", target: "Software", value: 22 },
  { source: "USA", target: "Grain", value: 8 },
  { source: "Brazil", target: "Oil", value: 9 },
  { source: "Brazil", target: "Grain", value: 14 },
  { source: "Brazil", target: "Meat", value: 11 },
  { source: "Germany", target: "Renewables", value: 10 },
  { source: "Germany", target: "Hardware", value: 13 },
  { source: "France", target: "Renewables", value: 7 },
  { source: "France", target: "Software", value: 9 },
  { source: "France", target: "Meat", value: 6 },
  { source: "China", target: "Hardware", value: 25 },
  { source: "China", target: "Software", value: 12 },
  { source: "China", target: "Renewables", value: 8 },
  { source: "Japan", target: "Hardware", value: 16 },
  { source: "Japan", target: "Software", value: 11 },
];

const HIER_DEFAULT_COLLAPSED = ["Americas", "Europe", "Asia", "Energy", "Tech", "Food"];

// Layout constants
const W = 560, H = 380;
const NODE_WIDTH = 12;
const NODE_PADDING = 6;
const GRIP_COLOR = "#334155";
const LINK_MIN = 0.5;

export class MdSankeyHierBireactive extends Diagram {
  static styles = `text { pointer-events: none; }`;
  private collapsed = new Set<string>(HIER_DEFAULT_COLLAPSED);

  protected scene(s: Mount): void {
    const view = this.view(W + 160, H + 64);

    // 1. Compute visible topology from hierarchy + collapsed state
    const flat = flattenHierarchy(HIER_NODES, HIER_LINKS, this.collapsed);

    // 2. Create root cells for each visible link (the writable roots)
    const linkCells = flat.linkDefs.map(l => ({
      source: l.source,
      target: l.target,
      value: num(l.init),
    }));

    // 3. Build topology (static for this collapsed state)
    const idToIdx = new Map<string, number>();
    flat.nodeIds.forEach((id, i) => idToIdx.set(id, i));
    const resolve = (v: string) => idToIdx.get(v) ?? -1;
    const src = flat.linkDefs.map(l => resolve(l.source));
    const tgt = flat.linkDefs.map(l => resolve(l.target));
    const topology: SankeyTopology = buildTopology(flat.nodeIds.length, src, tgt);

    // Compute initial pxPerUnit (fit to height once, then hold constant)
    const initialValues = linkCells.map(lc => lc.value.value);
    const initialNodeSums = new Array(flat.nodeIds.length).fill(0);
    initialValues.forEach((v, i) => {
      initialNodeSums[src[i]!] = Math.max(initialNodeSums[src[i]!] ?? 0, 0);
      initialNodeSums[tgt[i]!] = Math.max(initialNodeSums[tgt[i]!] ?? 0, 0);
    });
    initialValues.forEach((v, i) => {
      initialNodeSums[src[i]!] += v;
      initialNodeSums[tgt[i]!] += v;
    });
    const maxColSum = Math.max(...topology.columns.map(col =>
      col.reduce((sum, n) => sum + (initialNodeSums[n] ?? 0), 0)
    ));
    const pxPerUnit = (H - flat.nodeIds.length * NODE_PADDING) / Math.max(1, maxColSum);

    // 4. ONE big derive() that computes ALL geometry from root cells
    // Uses the existing pure computeLayout function - conservation is structural!
    const layout = derive<SankeyLayout>(() => {
      const values = linkCells.map(lc => lc.value.value);
      return computeLayout(topology, values, { W, pxPerUnit, nodeWidth: NODE_WIDTH, nodePadding: NODE_PADDING });
    });

    // 5. Render ribbons
    linkCells.forEach((lc, i) => {
      const path = derive(() => {
        const l = layout.value.links[i]!;
        return ribbonPath(l.x0, l.y0, l.x1, l.y1, l.width);
      });
      s(pathD(path, {
        fill: interpolateCool(i / linkCells.length),
        opacity: 0.4,
        stroke: "none",
      }));
    });

    // 6. Render node bars + click-to-expand/collapse
    const childrenOf = new Map<string, string[]>();
    for (const n of HIER_NODES) {
      if (n.parent) {
        const list = childrenOf.get(n.parent) ?? [];
        list.push(n.id);
        childrenOf.set(n.parent, list);
      }
    }
    const hasChildren = (id: string) => (childrenOf.get(id)?.length ?? 0) > 0;
    const parentOf = new Map(HIER_NODES.map(n => [n.id, n.parent ?? null] as const));

    flat.nodeIds.forEach((id, n) => {
      const isGroup = flat.isCollapsedGroup[n] || hasChildren(id);
      const bar = s(rect(
        Vec.derive(() => ({ x: layout.value.nodes[n]!.x0, y: layout.value.nodes[n]!.y0 })),
        derive(() => NODE_WIDTH),
        derive(() => layout.value.nodes[n]!.y1 - layout.value.nodes[n]!.y0),
        {
          fill: interpolateCool(n / flat.nodeIds.length),
          stroke: isGroup ? "#999" : "none",
          strokeWidth: isGroup ? 1 : 0,
          strokeDasharray: isGroup && flat.isCollapsedGroup[n] ? "3,2" : "none",
        }
      ));

      if (isGroup) {
        bar.el.style.cursor = "pointer";
        bar.el.addEventListener("dblclick", () => {
          if (this.collapsed.has(id)) {
            this.collapsed.delete(id);
          } else if (hasChildren(id)) {
            this.collapsed.add(id);
          } else {
            const p = parentOf.get(id);
            if (p) this.collapsed.add(p);
          }
          (this as any).root.clear();
          this.scene(this.s);
        });
      }

      // Node labels
      s(label(
        Vec.derive(() => {
          const nd = layout.value.nodes[n]!;
          return { x: nd.x0 + NODE_WIDTH / 2, y: nd.y0 - 4 };
        }),
        id,
        { size: 9, align: { x: 0.5, y: 1 }, fill: "#ccc" }
      ));
    });

    // 7. Add ribbon grips (write to root cells)
    linkCells.forEach((lc, i) => {
      const gripPos = Vec.derive(() => {
        const l = layout.value.links[i]!;
        // Position at bottom-right of ribbon, offset
        return { x: l.x1 + 12, y: l.y1 + l.width / 2 };
      });

      const dot = s(circle(gripPos, 5, {
        fill: GRIP_COLOR,
        stroke: "#000",
        strokeWidth: 1.5,
      }));
      dot.el.style.cursor = "ns-resize";

      // Lens: drag writes to the link's root cell
      const lens = Vec.lens(
        [lc.value],
        ([v]) => {
          // Use layout.value (not peek) so lens tracks layout changes
          const l = layout.value.links[i]!;
          return { x: l.x1 + 12, y: l.y1 + l.width / 2 };
        },
        (t, [v]) => {
          // Use peek in write since we're computing the change
          const l = layout.peek().links[i]!;
          const dy = t.y - (l.y1 + l.width / 2);
          const dv = dy / pxPerUnit;
          return [Math.max(LINK_MIN, v + dv)];
        }
      );

      dragCancelable(dot, lens, [lc.value], {
        host: this,
        onStart: () => {},
        onEnd: () => {},
      });
    });

    // 8. Group grips (scale all incoming+outgoing flows at a node)
    topology.columns.forEach((col) => {
      col.forEach((n) => {
        const groupLinks = [...topology.inc[n]!, ...topology.out[n]!];
        if (groupLinks.length === 0) return;

        const gripPos = Vec.derive(() => {
          const nd = layout.value.nodes[n]!;
          return { x: nd.x0 + NODE_WIDTH / 2, y: nd.y1 + 6 };
        });

        // Horizontal bar grip
        const bar = s(rect(
          Vec.derive(() => ({ x: gripPos.value.x - 16, y: gripPos.value.y - 2 })),
          cell(32),
          cell(4),
          { fill: GRIP_COLOR, rx: 2 }
        ));
        bar.el.style.cursor = "ns-resize";

        // 44x44 invisible hit zone
        const hitZone = s(rect(
          Vec.derive(() => ({ x: gripPos.value.x - 22, y: gripPos.value.y - 22 })),
          cell(44),
          cell(44),
          { fill: "transparent" }
        ));
        hitZone.el.style.cursor = "ns-resize";

        // Lens: scale all connected flows
        const sources = groupLinks.map(li => linkCells[li]!.value);
        const lens = Vec.lens(
          sources,
          (vals) => {
            // Use layout.value (not peek) so lens tracks layout changes
            const nd = layout.value.nodes[n]!;
            return { x: nd.x0 + NODE_WIDTH / 2, y: nd.y1 + 6 };
          },
          (t, vals) => {
            // Use peek in write since we're computing the change
            const nd = layout.peek().nodes[n]!;
            const dy = t.y - (nd.y1 + 6);
            const totalCurrent = vals.reduce((sum, v) => sum + v, 0);
            if (totalCurrent <= 0) return vals;
            const dv = dy / pxPerUnit;
            const newTotal = Math.max(LINK_MIN * vals.length, totalCurrent + dv);
            const scale = newTotal / totalCurrent;
            return vals.map(v => Math.max(LINK_MIN, v * scale));
          }
        );

        dragCancelable(hitZone, lens, sources, {
          host: this,
          onStart: () => {},
          onEnd: () => {},
        });
      });
    });

    s(label(view.bottom.up(40), "Bireactive hierarchical sankey - double-click bars to expand/collapse · conservation is structural", {
      size: 10,
      align: Anchor.Center,
      fill: "#9aa0a8",
    }));
  }
}
