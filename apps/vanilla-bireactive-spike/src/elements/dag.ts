// Original. A plain relational DAG — no enforced hierarchy. Nodes and
// edges with a soft force-style relaxation: edge springs pull connected
// nodes together, all pairs of nodes repel each other, and a weak center
// gravity keeps the cloud in frame. The relaxation runs each frame as a
// small step toward a stable layout. Drag a node to pin it; release to
// let it relax with the rest. Arrow keys nudge a focused node.

import {
  Anchor,
  Diagram,
  derive,
  drag,
  label,
  type Mount,
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
  { id: "alice",   name: "Alice",   color: "#5b8def" },
  { id: "bob",     name: "Bob",     color: "#5b8def" },
  { id: "carol",   name: "Carol",   color: "#7ed321" },
  { id: "dave",    name: "Dave",    color: "#7ed321" },
  { id: "eve",     name: "Eve",     color: "#f5a623" },
  { id: "frank",   name: "Frank",   color: "#f5a623" },
  { id: "grace",   name: "Grace",   color: "#e25c5c" },
  { id: "heidi",   name: "Heidi",   color: "#e25c5c" },
  { id: "ivan",    name: "Ivan",    color: "#9b59b6" },
  { id: "judy",    name: "Judy",    color: "#1abc9c" },
];
const EDGES: EdgeDef[] = [
  { from: "alice", to: "bob" },
  { from: "alice", to: "carol" },
  { from: "bob", to: "dave" },
  { from: "carol", to: "dave" },
  { from: "carol", to: "eve" },
  { from: "dave", to: "frank" },
  { from: "eve", to: "frank" },
  { from: "eve", to: "grace" },
  { from: "frank", to: "heidi" },
  { from: "grace", to: "heidi" },
  { from: "grace", to: "ivan" },
  { from: "heidi", to: "judy" },
  { from: "ivan", to: "judy" },
  { from: "alice", to: "grace" },
  { from: "bob", to: "frank" },
];

interface NodeRT {
  def: NodeDef;
  pos: Writable<Vec>;
  pinned: boolean;
}

export class MdDag extends Diagram {
  protected scene(s: Mount): void {
    const view = this.view(W, H);
    const cx = W / 2, cy = H / 2 + 20;

    const nodeMap = new Map<string, NodeRT>();
    NODES.forEach((n, i) => {
      const ang = (i / NODES.length) * Math.PI * 2;
      const r = 110;
      nodeMap.set(n.id, {
        def: n,
        pos: vec(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r),
        pinned: false,
      });
    });

    s(
      label(view.top.down(20), "plain relational DAG · force-style relaxation · drag any node, edges follow live", { size: 11, bold: true, align: Anchor.Center }),
      label(view.bottom.up(14), "edge springs + all-pairs repulsion + weak center gravity · running each frame · no enforced hierarchy", { size: 10 }),
    );

    for (const e of EDGES) {
      const a = nodeMap.get(e.from)!;
      const b = nodeMap.get(e.to)!;
      const d = derive(() => {
        const p = a.pos.value, q = b.pos.value;
        const dx = q.x - p.x, dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const tx = (dx / len) * Math.min(len * 0.35, 50);
        const ty = (dy / len) * Math.min(len * 0.35, 50);
        return `M ${p.x} ${p.y} C ${p.x + tx} ${p.y + ty}, ${q.x - tx} ${q.y - ty}, ${q.x} ${q.y}`;
      });
      s(pathD(d, { stroke: "#6a7a8f", strokeWidth: 1.5, fill: "none", opacity: 0.55 }));
    }

    const nodeW = 72, nodeH = 28;
    for (const n of nodeMap.values()) {
      const nx = derive(() => n.pos.value.x - nodeW / 2);
      const ny = derive(() => n.pos.value.y - nodeH / 2);
      const r = s(
        rect(nx, ny, nodeW, nodeH, {
          fill: n.def.color,
          corner: 14,
          opacity: 0.92,
          stroke: "#0b0d12",
          thin: true,
        }),
      );
      drag(r, n.pos);
      r.el.style.cursor = "grab";
      r.el.addEventListener("pointerdown", () => { n.pinned = true; });
      r.el.addEventListener("pointerup", () => { n.pinned = false; });
      r.el.setAttribute("tabindex", "0");
      r.el.style.outline = "none";
      r.el.addEventListener("keydown", (ev: Event) => {
        const e = ev as KeyboardEvent;
        const step = e.shiftKey ? 25 : 5;
        const cur = n.pos.value;
        let dx = 0, dy = 0;
        if (e.key === "ArrowLeft") dx = -step;
        else if (e.key === "ArrowRight") dx = +step;
        else if (e.key === "ArrowUp") dy = -step;
        else if (e.key === "ArrowDown") dy = +step;
        else return;
        e.preventDefault();
        n.pos.value = { x: cur.x + dx, y: cur.y + dy };
      });
      const lbl = s(
        label(
          Vec.derive(() => ({ x: n.pos.value.x, y: n.pos.value.y })),
          n.def.name,
          { size: 10, align: Anchor.Center, fill: "#0b0d12", bold: true },
        ),
      );
      lbl.el.style.pointerEvents = "none";
    }

    const idealEdgeLen = 100;
    const repulse = 1800;
    const centerPull = 0.01;
    const damping = 0.5;
    const PADDING = 40;

    const step = () => {
      const nodes = Array.from(nodeMap.values());
      const forces = new Map<string, { fx: number; fy: number }>();
      for (const n of nodes) forces.set(n.def.id, { fx: 0, fy: 0 });

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!, b = nodes[j]!;
          const pa = a.pos.value, pb = b.pos.value;
          const dx = pa.x - pb.x, dy = pa.y - pb.y;
          const d2 = Math.max(dx * dx + dy * dy, 100);
          const d = Math.sqrt(d2);
          const f = repulse / d2;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          forces.get(a.def.id)!.fx += fx;
          forces.get(a.def.id)!.fy += fy;
          forces.get(b.def.id)!.fx -= fx;
          forces.get(b.def.id)!.fy -= fy;
        }
      }

      for (const e of EDGES) {
        const a = nodeMap.get(e.from)!;
        const b = nodeMap.get(e.to)!;
        const pa = a.pos.value, pb = b.pos.value;
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const d = Math.hypot(dx, dy) || 1;
        const stretch = d - idealEdgeLen;
        const fx = (dx / d) * stretch * 0.05;
        const fy = (dy / d) * stretch * 0.05;
        forces.get(a.def.id)!.fx += fx;
        forces.get(a.def.id)!.fy += fy;
        forces.get(b.def.id)!.fx -= fx;
        forces.get(b.def.id)!.fy -= fy;
      }

      for (const n of nodes) {
        const p = n.pos.value;
        forces.get(n.def.id)!.fx += (cx - p.x) * centerPull;
        forces.get(n.def.id)!.fy += (cy - p.y) * centerPull;
      }

      for (const n of nodes) {
        if (n.pinned) continue;
        const f = forces.get(n.def.id)!;
        const p = n.pos.value;
        const nx = Math.max(PADDING + nodeW / 2, Math.min(W - PADDING - nodeW / 2, p.x + f.fx * damping));
        const ny = Math.max(PADDING + nodeH / 2 + 30, Math.min(H - PADDING - nodeH / 2, p.y + f.fy * damping));
        if (Math.abs(nx - p.x) > 0.05 || Math.abs(ny - p.y) > 0.05) {
          n.pos.value = { x: nx, y: ny };
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
