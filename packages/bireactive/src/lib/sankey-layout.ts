// Pure-function Sankey layout.
//
// d3-sankey is a SOLVER: it re-runs an iterative relaxation every time any value
// changes, so the whole diagram reflows under the cursor during a drag — rubbery,
// the opposite of direct manipulation. The bireactive reference sankey feels
// solid because its geometry is a PURE FUNCTION of the editable values (no
// solver, no reflow): a grip writes a value, geometry recomputes instantly, the
// grip stays exactly under the pointer.
//
// This module is that, generalized to an arbitrary layered DAG. Topology (which
// column a node is in, the stack order of nodes and of links) is STATIC —
// computed once from the graph, independent of values. Only the SIZING
// (throughputs, heights, y-offsets, ribbon widths) is a function of the live
// values, so `computeLayout(values)` is cheap and stable: same topology in,
// same positions out, no iteration.

export interface SankeyTopology {
  /** Number of nodes. */
  nodeCount: number;
  /** Column index per node (0 = leftmost source layer). */
  layer: number[];
  /** Max column index. */
  maxLayer: number;
  /** Source node index per link. */
  src: number[];
  /** Target node index per link. */
  tgt: number[];
  /** Outgoing link indices per node, in stack order (top→bottom). */
  out: number[][];
  /** Incoming link indices per node, in stack order (top→bottom). */
  inc: number[][];
  /** Nodes per column, in stack order (top→bottom). */
  columns: number[][];
}

export interface SankeyDims {
  /** Horizontal span (data space). Columns are spread across this width. */
  W: number;
  /** px of band width per unit of flow — a CONSTANT ruler. The diagram grows
   *  or shrinks in its own coordinate space as values change; it never refits
   *  itself to a container. Fitting is the viewer's job (viewBox), decoupled. */
  pxPerUnit: number;
  nodeWidth: number;
  nodePadding: number;
}

export interface Bounds { x: number; y: number; w: number; h: number }

export interface NodeBox {
  x0: number; x1: number; y0: number; y1: number;
  value: number;   // throughput = max(in, out)
  layer: number;
}

export interface LinkBand {
  /** Ribbon endpoints: vertical center at source side / target side. */
  sx: number; sy: number; tx: number; ty: number;
  width: number;   // px thickness = value * scale
  value: number;
  src: number; tgt: number;
}

export interface SankeyLayout {
  nodes: NodeBox[];
  links: LinkBand[];
  /** px per unit value — the CONSTANT ruler this layout was built with. Every
   *  pixel↔value conversion (drag, wheel, grip placement) must use THIS so all
   *  manipulation happens at the same scale the geometry was drawn at. */
  pxPerUnit: number;
  /** Data-space bounding box the diagram currently occupies. This is the
   *  diagram's OUTPUT contract: it announces its size, the viewer decides how to
   *  present it (auto-size the element, or fit via viewBox). The diagram never
   *  resizes itself to a container — that coupling is what causes relayout
   *  cascades on edit. */
  bounds: Bounds;
}

/**
 * Build the static topology from a graph. `src`/`tgt` are link endpoint node
 * indices. Layer = longest path from any source (Sugiyama-style longest-path
 * layering) so every link points strictly rightward. Stack orders are the input
 * order of nodes/links — stable and predictable for editing.
 */
export function buildTopology(nodeCount: number, src: number[], tgt: number[]): SankeyTopology {
  const out: number[][] = Array.from({ length: nodeCount }, () => []);
  const inc: number[][] = Array.from({ length: nodeCount }, () => []);
  for (let i = 0; i < src.length; i++) {
    out[src[i]!]!.push(i);
    inc[tgt[i]!]!.push(i);
  }

  // Longest-path layering. Repeatedly relax layer[t] = max(layer[t], layer[s]+1)
  // until stable. Bounded by node count (acyclic assumption; cycles just settle).
  const layer = new Array<number>(nodeCount).fill(0);
  for (let pass = 0; pass < nodeCount; pass++) {
    let changed = false;
    for (let i = 0; i < src.length; i++) {
      const want = layer[src[i]!]! + 1;
      if (want > layer[tgt[i]!]!) { layer[tgt[i]!] = want; changed = true; }
    }
    if (!changed) break;
  }
  // Pull sinks (no outgoing) to the last column so they align on the right edge.
  let maxLayer = 0;
  for (let i = 0; i < nodeCount; i++) maxLayer = Math.max(maxLayer, layer[i]!);
  for (let i = 0; i < nodeCount; i++) if (out[i]!.length === 0) layer[i] = maxLayer;

  const columns: number[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (let i = 0; i < nodeCount; i++) columns[layer[i]!]!.push(i);

  return { nodeCount, layer, maxLayer, src, tgt, out, inc, columns };
}

/** Node throughput per node = max(incoming sum, outgoing sum). */
function throughputs(topology: SankeyTopology, values: number[]): number[] {
  const { nodeCount, src, tgt } = topology;
  const inSum = new Array<number>(nodeCount).fill(0);
  const outSum = new Array<number>(nodeCount).fill(0);
  for (let i = 0; i < src.length; i++) {
    const v = Math.max(0, values[i]!);
    outSum[src[i]!]! += v;
    inSum[tgt[i]!]! += v;
  }
  const through = new Array<number>(nodeCount);
  for (let i = 0; i < nodeCount; i++) through[i] = Math.max(inSum[i]!, outSum[i]!);
  return through;
}

/**
 * Compute geometry for the current values at a CONSTANT px-per-unit ruler. Pure:
 * positions depend only on `values` + `topology` + `dims`. There is no fit-to-
 * height step — the diagram grows or shrinks honestly in its own coordinate
 * space as flows change, and reports its `bounds`. It never rescales itself to a
 * container; that coupling is exactly the d3-sankey "everything reflows mid-drag"
 * rubberiness we dropped d3 to avoid. The viewer fits the announced bounds (via
 * viewBox), decoupled — see SankeyLayout.bounds.
 *
 * Each column is stacked from its own top; columns are then vertically centered
 * against the tallest one, so the whole figure is balanced without coupling any
 * column's size to another.
 */
export function computeLayout(
  topology: SankeyTopology,
  values: number[],
  dims: SankeyDims,
): SankeyLayout {
  const { nodeCount, layer, maxLayer, out, inc, columns } = topology;
  const { W, pxPerUnit, nodeWidth, nodePadding } = dims;

  const through = throughputs(topology, values);

  // Column heights at the constant ruler; the figure height is the tallest.
  const colHeight = (col: number[]) =>
    col.reduce((a, n) => a + through[n]! * pxPerUnit, 0) + nodePadding * Math.max(0, col.length - 1);
  let figH = 0;
  for (const col of columns) figH = Math.max(figH, colHeight(col));

  // Column x positions: evenly spaced left→right.
  const colX = (l: number) =>
    maxLayer === 0 ? 0 : (l / maxLayer) * (W - nodeWidth);

  // Place nodes: stack each column top→bottom, centered against the tallest.
  const nodes: NodeBox[] = new Array(nodeCount);
  for (const col of columns) {
    let y = (figH - colHeight(col)) / 2;
    for (const n of col) {
      const h = through[n]! * pxPerUnit;
      const x0 = colX(layer[n]!);
      nodes[n] = { x0, x1: x0 + nodeWidth, y0: y, y1: y + h, value: through[n]!, layer: layer[n]! };
      y += h + nodePadding;
    }
  }

  // Stack link endpoints within each node (outgoing on source's right face,
  // incoming on target's left face), in topology stack order. Two passes: a link
  // is created on its SOURCE node's outgoing pass, then its target end is filled
  // on its TARGET node's incoming pass. These must be separate full passes —
  // doing both per-node in one loop fails when a link's target node is iterated
  // before its source node (the incoming branch would touch a not-yet-created
  // link).
  const links: LinkBand[] = new Array(topology.src.length);
  const outOff = nodes.map((n) => n.y0);
  const incOff = nodes.map((n) => n.y0);
  for (let n = 0; n < nodeCount; n++) {
    for (const li of out[n]!) {
      const w = Math.max(0, values[li]!) * pxPerUnit;
      const sy = outOff[n]! + w / 2;
      outOff[n]! += w;
      links[li] = { sx: nodes[n]!.x1, sy, tx: 0, ty: 0, width: w, value: Math.max(0, values[li]!), src: n, tgt: topology.tgt[li]! };
    }
  }
  for (let n = 0; n < nodeCount; n++) {
    for (const li of inc[n]!) {
      const w = Math.max(0, values[li]!) * pxPerUnit;
      const ty = incOff[n]! + w / 2;
      incOff[n]! += w;
      links[li]!.tx = nodes[n]!.x0;
      links[li]!.ty = ty;
    }
  }

  // Announce true bounds (node bars span x; ribbons stay within the figure height).
  const bounds: Bounds = { x: 0, y: 0, w: W, h: figH };

  return { nodes, links, pxPerUnit, bounds };
}

/** Constant-width horizontal ribbon path (two mirrored cubic curves). */
export function ribbonPath(b: LinkBand): string {
  const h = b.width / 2;
  const xm = (b.sx + b.tx) / 2;
  return (
    `M ${b.sx} ${b.sy - h} C ${xm} ${b.sy - h} ${xm} ${b.ty - h} ${b.tx} ${b.ty - h} ` +
    `L ${b.tx} ${b.ty + h} C ${xm} ${b.ty + h} ${xm} ${b.sy + h} ${b.sx} ${b.sy + h} Z`
  );
}
