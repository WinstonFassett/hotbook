// Original. A DAG with multiple layout algorithms; pick one to morph the
// graph into that layout. The same node identities walk smoothly between
// layouts because each node's actual `pos` is a writable Vec cell driven
// by a per-frame tween toward whatever layout's TARGET position is
// currently selected.
//
// Layouts (all hand-coded — no upstream propagator dependency):
//   - Layered TB    longest-path layering, barycenter sweep, top→bottom
//   - Layered LR    same, left→right
//   - Radial        concentric rings by topo depth
//   - Grid          column-major, fills a square
//
// User can also drag a node to override its position; clicking a layout
// button resets to that layout's targets.

import {
  Anchor,
  cell,
  Diagram,
  derive,
  drag,
  label,
  type Mount,
  Num,
  pathD,
  rect,
  vec,
  Vec,
  type Writable,
} from "bireactive";

const W = 760;
const H = 460;

interface NodeDef { id: string; name: string; color: string; }
interface EdgeDef { from: string; to: string; }

const NODES: NodeDef[] = [
  { id: "clone",   name: "clone",   color: "#5b8def" },
  { id: "install", name: "install", color: "#5b8def" },
  { id: "lint",    name: "lint",    color: "#7ed321" },
  { id: "test",    name: "test",    color: "#7ed321" },
  { id: "build",   name: "build",   color: "#7ed321" },
  { id: "type",    name: "type",    color: "#7ed321" },
  { id: "bundle",  name: "bundle",  color: "#f5a623" },
  { id: "image",   name: "image",   color: "#f5a623" },
  { id: "stage",   name: "stage",   color: "#e25c5c" },
  { id: "smoke",   name: "smoke",   color: "#e25c5c" },
  { id: "deploy",  name: "deploy",  color: "#9b59b6" },
  { id: "notify",  name: "notify",  color: "#1abc9c" },
];
const EDGES: EdgeDef[] = [
  { from: "clone",   to: "install" },
  { from: "install", to: "lint" },
  { from: "install", to: "test" },
  { from: "install", to: "build" },
  { from: "install", to: "type" },
  { from: "lint",    to: "bundle" },
  { from: "test",    to: "bundle" },
  { from: "build",   to: "bundle" },
  { from: "type",    to: "bundle" },
  { from: "build",   to: "image" },
  { from: "bundle",  to: "stage" },
  { from: "image",   to: "stage" },
  { from: "stage",   to: "smoke" },
  { from: "smoke",   to: "deploy" },
  { from: "deploy",  to: "notify" },
];

type LayoutId = "layered-tb" | "layered-lr" | "radial" | "grid";
const LAYOUTS: Array<{ id: LayoutId; label: string }> = [
  { id: "layered-tb", label: "Layered ↓" },
  { id: "layered-lr", label: "Layered →" },
  { id: "radial",     label: "Radial" },
  { id: "grid",       label: "Grid" },
];

// --- layout algorithms ---
type Pt = { x: number; y: number };

function layerAssignment(): Map<string, number> {
  const layer = new Map<string, number>();
  const indeg = new Map<string, number>();
  for (const n of NODES) indeg.set(n.id, 0);
  for (const e of EDGES) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const queue: string[] = [];
  for (const [k, v] of indeg) if (v === 0) { queue.push(k); layer.set(k, 0); }
  while (queue.length) {
    const k = queue.shift()!;
    for (const e of EDGES.filter(x => x.from === k)) {
      layer.set(e.to, Math.max(layer.get(e.to) ?? 0, (layer.get(k) ?? 0) + 1));
      const n = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, n);
      if (n === 0) queue.push(e.to);
    }
  }
  return layer;
}

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function layered(direction: "TB" | "LR"): Map<string, Pt> {
  const layer = layerAssignment();
  const maxLayer = Math.max(...layer.values());
  const byLayer: Record<number, string[]> = {};
  for (const n of NODES) (byLayer[layer.get(n.id)!] ||= []).push(n.id);

  // Barycenter sweep, then assign within-layer fractional positions.
  // Solitary nodes are centered (frac=0.5); multi-node layers fan out.
  const xFrac = new Map<string, number>();
  for (let l = 0; l <= maxLayer; l++) {
    const layerNodes = byLayer[l] ?? [];
    let sorted: string[];
    if (l === 0) {
      sorted = layerNodes;
    } else {
      sorted = [...layerNodes].sort((a, b) => {
        const ax = mean(EDGES.filter(e => e.to === a).map(e => xFrac.get(e.from) ?? 0.5));
        const bx = mean(EDGES.filter(e => e.to === b).map(e => xFrac.get(e.from) ?? 0.5));
        return ax - bx;
      });
    }
    if (sorted.length === 1) {
      xFrac.set(sorted[0]!, 0.5);
    } else {
      sorted.forEach((id, i) => xFrac.set(id, i / (sorted.length - 1)));
    }
  }

  const M = 70;
  const innerM = 30;
  const out = new Map<string, Pt>();
  if (direction === "TB") {
    const top = M, bot = H - M, lx = M + innerM, rx = W - M - innerM;
    for (const n of NODES) {
      const ly = top + (layer.get(n.id)! / Math.max(maxLayer, 1)) * (bot - top);
      out.set(n.id, { x: lx + (xFrac.get(n.id)!) * (rx - lx), y: ly });
    }
  } else {
    const lft = M, rgt = W - M, ty = M + 30 + innerM, by_ = H - M - innerM;
    for (const n of NODES) {
      const lx = lft + (layer.get(n.id)! / Math.max(maxLayer, 1)) * (rgt - lft);
      out.set(n.id, { x: lx, y: ty + (xFrac.get(n.id)!) * (by_ - ty) });
    }
  }
  return out;
}

function radialLayout(): Map<string, Pt> {
  // Truly radial: depth = radius. Source at center; descendants on
  // expanding rings. Within a layer, nodes are spread around the FULL
  // circle so multi-node layers fan out, and solitary nodes don't all
  // pile at top.

  const layer = layerAssignment();
  const maxLayer = Math.max(...layer.values());
  const byLayer: Record<number, string[]> = {};
  for (const n of NODES) (byLayer[layer.get(n.id)!] ||= []).push(n.id);

  // Sort each layer by barycenter of its predecessors' angles so children
  // sit near their parents.
  const angOf = new Map<string, number>();

  // Layer 0 nodes get angles spread around full circle.
  const l0 = byLayer[0] ?? [];
  l0.forEach((id, i) => {
    const ang = l0.length === 1 ? -Math.PI / 2 : -Math.PI / 2 + (i / l0.length) * Math.PI * 2;
    angOf.set(id, ang);
  });

  for (let l = 1; l <= maxLayer; l++) {
    const layerNodes = byLayer[l] ?? [];
    // Bary-angle = circular mean of predecessor angles.
    const baryOf = (id: string): number => {
      const preds = EDGES.filter(e => e.to === id).map(e => angOf.get(e.from) ?? 0);
      if (!preds.length) return Math.random() * Math.PI * 2;
      // Circular mean
      let sx = 0, sy = 0;
      for (const a of preds) { sx += Math.cos(a); sy += Math.sin(a); }
      return Math.atan2(sy, sx);
    };
    const positioned = layerNodes
      .map(id => ({ id, ang: baryOf(id) }))
      .sort((a, b) => a.ang - b.ang);
    // Spread to ensure minimum angular gap proportional to count.
    const minGap = (Math.PI * 2) / Math.max(positioned.length * 1.5, 6);
    let prev = -Infinity;
    positioned.forEach((p, _i) => {
      let a = p.ang;
      if (a < prev + minGap) a = prev + minGap;
      angOf.set(p.id, a);
      prev = a;
    });
  }

  const cx = W / 2, cy = H / 2 + 30;
  const rStep = Math.min(W, H) * 0.13;
  const out = new Map<string, Pt>();
  for (const n of NODES) {
    const l = layer.get(n.id)!;
    const r = l * rStep;
    const ang = angOf.get(n.id) ?? 0;
    out.set(n.id, { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
  }
  return out;
}

function gridLayout(): Map<string, Pt> {
  const cols = Math.ceil(Math.sqrt(NODES.length));
  const rows = Math.ceil(NODES.length / cols);
  const M = 80;
  const cw = (W - 2 * M) / Math.max(cols - 1, 1);
  const ch = (H - 2 * M - 30) / Math.max(rows - 1, 1);
  const out = new Map<string, Pt>();
  NODES.forEach((n, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.set(n.id, { x: M + c * cw, y: M + 30 + r * ch });
  });
  return out;
}

const LAYOUT_FNS: Record<LayoutId, () => Map<string, Pt>> = {
  "layered-tb": () => layered("TB"),
  "layered-lr": () => layered("LR"),
  "radial":     radialLayout,
  "grid":       gridLayout,
};

interface NodeRT {
  def: NodeDef;
  pos: Writable<Vec>;
}

export class MdLayoutPicker extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);

    // Selected layout target — drives a tween. A bireactive cell so the
    // active-button visuals re-derive.
    const selectedCell = cell<LayoutId>("layered-tb");

    // Compute initial target positions and create writable Vec cells.
    const initial = LAYOUT_FNS[selectedCell.value]();
    const nodeMap = new Map<string, NodeRT>();
    for (const n of NODES) {
      const p = initial.get(n.id)!;
      nodeMap.set(n.id, { def: n, pos: vec(p.x, p.y) });
    }

    // Tween — RAF-driven exponential approach to layout targets.
    let raf = 0;
    const tickRate = 0.18;
    const step = () => {
      const targets = LAYOUT_FNS[selectedCell.value]();
      let dirty = false;
      for (const n of nodeMap.values()) {
        const t = targets.get(n.def.id)!;
        const cur = n.pos.value;
        const nx = cur.x + (t.x - cur.x) * tickRate;
        const ny = cur.y + (t.y - cur.y) * tickRate;
        if (Math.hypot(nx - cur.x, ny - cur.y) > 0.5) {
          n.pos.value = { x: nx, y: ny };
          dirty = true;
        } else if (cur.x !== t.x || cur.y !== t.y) {
          n.pos.value = { x: t.x, y: t.y };
        }
      }
      raf = dirty ? requestAnimationFrame(step) : 0;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(step); };

    // Header + footer
    s(
      label(view.top.down(20), "DAG with switchable layouts — click a button to morph", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(14), "same node identities across layouts · positions tween to layout targets · drag nodes to override", { size: 10 }),
    );

    // Layout picker buttons
    LAYOUTS.forEach((L, k) => {
      const bx = 30 + k * 100, by = 50, bw = 90, bh = 26;
      const fillCell = derive(() => (selectedCell.value === L.id ? "#5b8def" : "#23304a"));
      const btn = s(
        rect(bx, by, bw, bh, {
          fill: fillCell,
          stroke: "#5b8def",
          thin: true,
          corner: 5,
        }),
      );
      btn.el.style.cursor = "pointer";
      btn.el.addEventListener("click", () => {
        selectedCell.value = L.id;
        kick();
      });
      const lbl = s(label(Vec.derive(() => ({ x: bx + bw / 2, y: by + bh / 2 })), L.label, {
        size: 11, align: Anchor.Center, fill: "#fff", bold: true,
      }));
      lbl.el.style.pointerEvents = "none";
    });

    // Layer guides — visible tier bands for the layered layouts. Computed
     // once from the static graph; opacity ties to the selected layout so
     // they fade in/out as you switch modes.
    {
      const layerMap = layerAssignment();
      const maxLayer = Math.max(...layerMap.values());
      const M = 70;
      const innerM = 30;
      // Group nodes by layer for tier labels.
      const byLayer = new Map<number, string[]>();
      for (const [id, l] of layerMap) {
        const arr = byLayer.get(l) ?? [];
        arr.push(id);
        byLayer.set(l, arr);
      }
      const tbOpacity = derive(() => selectedCell.value === "layered-tb" ? 0.18 : 0);
      const lrOpacity = derive(() => selectedCell.value === "layered-lr" ? 0.18 : 0);
      const tbLabelOpacity = derive(() => selectedCell.value === "layered-tb" ? 0.55 : 0);
      const lrLabelOpacity = derive(() => selectedCell.value === "layered-lr" ? 0.55 : 0);

      // TB: horizontal bands at each layer's y.
      const top = M, bot = H - M;
      for (let l = 0; l <= maxLayer; l++) {
        const ly = top + (l / Math.max(maxLayer, 1)) * (bot - top);
        const stripH = 36;
        s(
          rect(40, ly - stripH / 2, W - 80, stripH, {
            fill: "#5b8def",
            opacity: tbOpacity,
            corner: 4,
          }),
          label(
            Vec.derive(() => ({ x: 52, y: ly })),
            `L${l}`,
            { size: 9, fill: "#7da8f0", opacity: tbLabelOpacity, bold: true },
          ),
        );
      }
      // LR: vertical bands at each layer's x.
      const lft = M, rgt = W - M;
      for (let l = 0; l <= maxLayer; l++) {
        const lx = lft + (l / Math.max(maxLayer, 1)) * (rgt - lft);
        const stripW = 36;
        s(
          rect(lx - stripW / 2, 80, stripW, H - 130, {
            fill: "#5b8def",
            opacity: lrOpacity,
            corner: 4,
          }),
          label(
            Vec.derive(() => ({ x: lx, y: 92 })),
            `L${l}`,
            { size: 9, align: Anchor.Center, fill: "#7da8f0", opacity: lrLabelOpacity, bold: true },
          ),
        );
      }
    }

    // Edges as derived bezier paths.
    for (const e of EDGES) {
      const a = nodeMap.get(e.from)!;
      const b = nodeMap.get(e.to)!;
      const d = derive(() => {
        const p = a.pos.value, q = b.pos.value;
        const dx = q.x - p.x, dy = q.y - p.y;
        // Tangent vector along the direction
        const len = Math.hypot(dx, dy) || 1;
        const tx = dx / len * Math.min(len * 0.4, 60);
        const ty = dy / len * Math.min(len * 0.4, 60);
        return `M ${p.x} ${p.y} C ${p.x + tx} ${p.y + ty}, ${q.x - tx} ${q.y - ty}, ${q.x} ${q.y}`;
      });
      s(pathD(d, { stroke: "#6a7a8f", strokeWidth: 1.5, fill: "none", opacity: 0.7 }));
    }

    // Nodes
    const nodeW = 80, nodeH = 30;
    for (const n of nodeMap.values()) {
      const cx = derive(() => n.pos.value.x);
      const cy = derive(() => n.pos.value.y);
      const nx = derive(() => cx.value - nodeW / 2);
      const ny = derive(() => cy.value - nodeH / 2);
      const r = s(
        rect(nx, ny, nodeW, nodeH, {
          fill: n.def.color,
          corner: 6,
          opacity: 0.92,
          stroke: "#0b0d12",
          thin: true,
        }),
      );
      drag(r, n.pos);
      r.el.style.cursor = "grab";
      const nameLbl = s(
        label(
          Vec.derive(() => ({ x: cx.value, y: cy.value })),
          n.def.name,
          { size: 11, align: Anchor.Center, fill: "#0b0d12", bold: true },
        ),
      );
      nameLbl.el.style.pointerEvents = "none";
    }

    // Re-fill active button: simpler approach — track the index in a Num
    // cell and recompute fill from it.
    // (Already kicked initial tween via kick() implicitly when targets
    // differ from initial; we also call once to be safe.)
    kick();
  }
}
