import {
  Anchor,
  Diagram,
  cell,
  derive,
  label,
  pathD,
  rect,
  vec,
  type Mount,
} from "bireactive";
import {
  sankey as d3sankey,
  sankeyJustify,
  sankeyLinkHorizontal,
  type SankeyGraph,
  type SankeyLink,
  type SankeyNode,
} from "d3-sankey";

const W = 560;
const H = 340;
const NODE_W = 10;
const NODE_PAD = 8;

interface N { id: string }
interface L { value: number }

type LayoutNode = SankeyNode<N, L>;
type LayoutLink = SankeyLink<N, L> & { index: number };

const DATA = {
  nodes: [
    { id: "A1" }, { id: "A2" }, { id: "A3" },
    { id: "B1" }, { id: "B2" }, { id: "B3" }, { id: "B4" },
    { id: "C1" }, { id: "C2" }, { id: "C3" },
    { id: "D1" }, { id: "D2" },
  ],
  links: [
    { source: "A1", target: "B1", value: 27 },
    { source: "A1", target: "B2", value: 9 },
    { source: "A2", target: "B2", value: 5 },
    { source: "A2", target: "B3", value: 11 },
    { source: "A3", target: "B2", value: 12 },
    { source: "A3", target: "B4", value: 7 },
    { source: "B1", target: "C1", value: 13 },
    { source: "B1", target: "C2", value: 10 },
    { source: "B4", target: "C2", value: 5 },
    { source: "B4", target: "C3", value: 2 },
    { source: "B1", target: "D1", value: 4 },
    { source: "C3", target: "D1", value: 1 },
    { source: "C3", target: "D2", value: 1 },
  ],
};

export class MdSankeyLC extends Diagram {
  protected scene(s: Mount): void {
    this.view(W + 48, H + 24);

    // Run layout once (static data)
    const graph = d3sankey<N, L>()
      .nodeId((d) => d.id)
      .nodeAlign(sankeyJustify)
      .nodeWidth(NODE_W)
      .nodePadding(NODE_PAD)
      .extent([[0, 0], [W, H]])(
        JSON.parse(JSON.stringify(DATA)) as SankeyGraph<N, L>
      );

    const nodes = graph.nodes as LayoutNode[];
    const links = graph.links as LayoutLink[];

    const linkPath = sankeyLinkHorizontal();
    const hoveredNodeId = cell<string | null>(null);

    // Links (ribbons) — render before nodes so nodes paint over endpoints
    for (const lk of links) {
      const srcId = (lk.source as LayoutNode).id;
      const tgtId = (lk.target as LayoutNode).id;
      const d = linkPath(lk as any) ?? "";
      const opacity = derive(() => {
        const h = hoveredNodeId.value;
        if (h === null) return 0.15;
        return h === srcId || h === tgtId ? 0.45 : 0.04;
      });
      s(pathD(cell(d), {
        stroke: "#6ab0f5",
        strokeWidth: cell(lk.width ?? 1),
        fill: "none",
        cap: "butt",
        opacity,
      }));
    }

    // Nodes
    for (const n of nodes) {
      const x0 = n.x0 ?? 0;
      const y0 = n.y0 ?? 0;
      const nw = (n.x1 ?? 0) - x0;
      const nh = (n.y1 ?? 0) - y0;
      const isRightmost = (n.targetLinks?.length ?? 0) === 0;

      const r = s(rect(x0, y0, nw, nh, { fill: "#6ab0f5" }));
      r.el.style.cursor = "default";
      r.el.addEventListener("pointerenter", () => { hoveredNodeId.value = n.id; });
      r.el.addEventListener("pointerleave", () => { hoveredNodeId.value = null; });

      // Label
      const lx = isRightmost ? x0 - 4 : x0 + nw + 4;
      const ly = y0 + nh / 2;
      s(label(vec(lx, ly), cell(n.id), {
        size: 11,
        align: isRightmost ? Anchor.Right : Anchor.Left,
        fill: "#cdd5e0",
      }));
    }
  }
}
