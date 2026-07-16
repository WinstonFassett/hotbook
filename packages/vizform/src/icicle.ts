import { effect, untracked } from "bireactive";
import * as d3Hierarchy from "d3-hierarchy";
import { select, type Selection } from "d3-selection";
import { interpolateObject } from "d3-interpolate";
import { easeCubicInOut } from "d3-ease";
import "d3-transition";
import { buildTree, colorFor } from "@hotbook/core";
import type { VizNode } from "@hotbook/core";
import { DataView, type IcicleConfig, type Orientation } from "./data-view.js";

const TRANSITION_DURATION = 400;
const EXIT_DURATION = 200;

interface TreeDatum {
  id: string;
  children?: TreeDatum[];
}

interface RectLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CellEl extends SVGGElement {
  __layout?: RectLayout;
  __data?: NodeData;
}

interface NodeData extends d3Hierarchy.HierarchyRectangularNode<TreeDatum> {
  vizNode: VizNode | undefined;
  layout: RectLayout;
}

/** Build a map from node id to VizNode. */
function nodeMapOf(nodes: readonly VizNode[]): Map<string, VizNode> {
  const map = new Map<string, VizNode>();
  for (const n of nodes) map.set(n.id, n);
  return map;
}

/** Compute the icicle partition layout for the current view. */
function computeLayout(
  nodes: readonly VizNode[],
  cfg: IcicleConfig,
  focusId: string | null,
  width: number,
  _height: number
): {
  focus: d3Hierarchy.HierarchyRectangularNode<TreeDatum>;
  nodeMap: Map<string, VizNode>;
  focusDepth: number;
  depthLimit: number;
  maxDepth: number;
} {
  const tree = buildTree(nodes.slice(), cfg.measure);
  const nodeMap = nodeMapOf(nodes);
  const sumValue = (d: TreeDatum) =>
    d.id === "__root__" || d.children ? 0 : (nodeMap.get(d.id)?.measures[cfg.measure] ?? 0);

  const sortBy = (a: d3Hierarchy.HierarchyNode<TreeDatum>, b: d3Hierarchy.HierarchyNode<TreeDatum>) => {
    if (cfg.sort === "value") {
      return (b.value ?? 0) - (a.value ?? 0);
    }
    const ai = nodeMap.get(a.data.id)?.index ?? 0;
    const bi = nodeMap.get(b.data.id)?.index ?? 0;
    return ai - bi;
  };

  const root = d3Hierarchy
    .hierarchy<TreeDatum>(tree)
    .sum(sumValue)
    .sort(sortBy) as d3Hierarchy.HierarchyRectangularNode<TreeDatum>;

  // Only the x-axis (sibling span) is used; y-axis is computed from depth.
  d3Hierarchy.partition<TreeDatum>().size([width, 1]).padding(0).round(false)(root);

  let focus = root;
  if (focusId && focusId !== "__root__") {
    const found = root.descendants().find((d) => d.data.id === focusId);
    if (found) focus = found;
  }

  const depthLimit = Math.max(1, cfg.depth ?? 4);
  // The focus node is the top-level; __root__ is not rendered, so its children
  // become the top-level.
  const focusDepth = focus.depth + (focus.data.id === "__root__" ? 1 : 0);
  const maxDepth = focusDepth + depthLimit - 1;

  return { focus, nodeMap, focusDepth, depthLimit, maxDepth };
}

/** Map a d3 partition node to screen coordinates, applying the focus viewport. */
function layoutOf(
  d: d3Hierarchy.HierarchyRectangularNode<TreeDatum>,
  focus: d3Hierarchy.HierarchyRectangularNode<TreeDatum>,
  focusDepth: number,
  depthLimit: number,
  width: number,
  height: number,
  orientation: Orientation
): RectLayout {
  const fX = focus.x0;
  const fW = Math.max(1, focus.x1 - focus.x0);
  const sx = width / fW;

  const levelHeight = height / depthLimit;
  const k = d.depth - focusDepth;

  // x0..x1 is sibling span; y is depth level.
  let x = (d.x0 - fX) * sx;
  let y = k * levelHeight;
  let w = Math.max(0, (d.x1 - d.x0) * sx - 1);
  let h = Math.max(0, levelHeight - 1);

  if (orientation === "horizontal") {
    // Swap axes: depth along x, siblings along y.
    const tmpX = x;
    x = y;
    y = tmpX;
    const tmpW = w;
    w = h;
    h = tmpW;
  }

  return { x, y, w, h };
}

function fitsLabel(layout: RectLayout): boolean {
  return layout.w > 36 && layout.h > 16;
}

/** VfIcicle — clean, bireactive-backed icicle chart.
 *
 * Reads from a `DataView` and renders the current view, with D3 transitions for
 * `commit`/`cancel`/`updated` and immediate re-render for `draft`.
 */
export class VfIcicle extends HTMLElement {
  static tag = "vf-icicle";
  dataView: DataView | null = null;
  private svg: SVGSVGElement | null = null;
  private cleanup: (() => void) | null = null;
  private width = 0;
  private height = 0;
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback() {
    if (!this.svg) {
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.style.cssText = "width:100%;height:100%;display:block;";
      this.appendChild(this.svg);
    }
    this.resize();
    this.observeResize();
    if (this.dataView) {
      this.bind();
    }
  }

  disconnectedCallback() {
    this.cleanup?.();
    this.cleanup = null;
  }

  setDataView(dataView: DataView) {
    this.dataView = dataView;
    if (this.isConnected) this.bind();
  }

  private observeResize() {
    const ro = new ResizeObserver(() => this.resize());
    if (this.svg) ro.observe(this.svg);
  }

  private onWheel(event: WheelEvent, d: NodeData) {
    if (!this.dataView) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();

    const dataView = this.dataView;
    const cfg = dataView.config.value;
    const measure = cfg.measure;
    const currentValue = d.vizNode?.measures[measure] ?? 0;
    const ratio = event.shiftKey ? 0.01 : 0.1;
    const step = Math.max(1, Math.abs(currentValue * ratio));
    const delta = Math.sign(event.deltaY) === 1 ? -step : step;
    const newValue = Math.max(0, currentValue + delta);

    dataView.setDraft(
      "edit",
      (nodes) =>
        nodes.map((n) =>
          n.id === d.data.id
            ? { ...n, measures: { ...n.measures, [measure]: newValue } }
            : n
        ) as VizNode[],
      { id: d.data.id, value: newValue }
    );

    if (this.wheelTimer) clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => dataView.commit(), 150);
  }

  private resize() {
    if (!this.svg) return;
    const rect = this.getBoundingClientRect();
    this.width = rect.width || 800;
    this.height = rect.height || 300;
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    if (this.dataView) this.render(false);
  }

  private bind() {
    this.cleanup?.();
    if (!this.dataView) return;
    this.cleanup = effect(() => {
      const dataView = this.dataView!;
      const state = dataView.editor.state.value;
      const event = dataView.editor.event.value;

      // Subscribe to data/config/focus so the effect re-runs when they change.
      void dataView.current.value;
      void dataView.config.value;
      void dataView.focus.value;

      // The Editor is Idle at commit/cancel/updated; the chart owns the transition.
      // Drafting means immediate (no transition). The initial event is null.
      const shouldTransition = state !== "Drafting" && event !== null;
      this.render(shouldTransition);
    });
  }

  private render(animate: boolean) {
    if (!this.svg || !this.dataView) return;
    const dataView = this.dataView;
    const nodes = untracked(() => dataView.current.value);
    const cfg = untracked(() => dataView.config.value);
    const sort = untracked(() => dataView.effectiveSort.value);
    const focusId = untracked(() => dataView.focus.value);

    const { focus, nodeMap, focusDepth, depthLimit, maxDepth } = computeLayout(
      nodes,
      { ...cfg, sort },
      focusId,
      this.width,
      this.height
    );

    const visibleNodes = focus
      .descendants()
      .filter((d) => d.data.id !== "__root__" && d.depth >= focusDepth && d.depth <= maxDepth)
      .map((d) => {
        const layout = layoutOf(d, focus, focusDepth, depthLimit, this.width, this.height, cfg.orientation);
        const vizNode = nodeMap.get(d.data.id);
        return Object.assign(d, { layout, vizNode }) as NodeData;
      });

    const svg = select(this.svg);
    const colorForId = (id: string) => nodeMap.get(id)?.color ?? colorFor(id);

    const sel = svg
      .selectAll<CellEl, NodeData>("g.vf-cell")
      .data(visibleNodes, (d) => d.data.id);

    // Exit
    const exit = sel.exit<CellEl>();
    if (animate) {
      exit.interrupt("layout").transition("layout").duration(EXIT_DURATION).style("opacity", 0).remove();
    } else {
      exit.interrupt("layout").remove();
    }

    // Enter
    const entered = sel
      .enter()
      .append<SVGGElement>("g")
      .attr("class", "vf-cell")
      .attr("cursor", "pointer")
      .style("opacity", 0)
      .each(function (this: SVGGElement, d: NodeData) {
        const el = this as CellEl;
        el.__layout = d.layout;
        el.__data = d;
      });

    entered.append("rect").attr("stroke", "#fff").attr("stroke-width", 0.5);
    entered.append("text").attr("fill", "oklch(0.18 0.01 250)").attr("pointer-events", "none");

    // Click to drill / drill-out.
    entered.on("click", (event, d) => {
      event.stopPropagation();
      if (!this.dataView) return;
      if (d.data.id === this.dataView.focus.value) {
        this.dataView.setFocus(d.parent?.data.id ?? null);
      } else if (d.children) {
        this.dataView.setFocus(d.data.id);
      }
    });

    // Merge enter + update
    const merged = entered.merge(sel as unknown as Selection<SVGGElement, NodeData, SVGSVGElement, unknown>);

    merged.on("wheel", (event, d) => this.onWheel(event as WheelEvent, d));

    if (animate) {
      merged
        .interrupt("layout")
        .transition("layout")
        .duration(TRANSITION_DURATION)
        .ease(easeCubicInOut)
        .style("opacity", 1)
        .tween("layout", function (this: SVGGElement, d: NodeData) {
          const el = this as CellEl;
          const start = el.__layout ?? d.layout;
          const end = d.layout;
          const i = interpolateObject(start, end) as (t: number) => RectLayout;
          const g = select(this);
          const rect = g.select<SVGRectElement>("rect");
          const text = g.select<SVGTextElement>("text");
          return (t: number) => {
            const cur = i(t);
            el.__layout = cur;
            rect.attr("x", 0).attr("y", 0).attr("width", cur.w).attr("height", cur.h);
            g.attr("transform", `translate(${cur.x},${cur.y})`);
            if (fitsLabel(cur)) {
              text.attr("x", 6).attr("y", 14).style("display", "inline").text(labelFor(d, cur));
            } else {
              text.style("display", "none").text("");
            }
          };
        });
    } else {
      merged.interrupt("layout").each(function (this: SVGGElement, d: NodeData) {
        const el = this as CellEl;
        const cur = d.layout;
        el.__layout = cur;
        el.__data = d;
        const g = select(this);
        const rect = g.select<SVGRectElement>("rect");
        const text = g.select<SVGTextElement>("text");
        rect
          .attr("x", 0)
          .attr("y", 0)
          .attr("width", cur.w)
          .attr("height", cur.h)
          .attr("fill", colorForId(d.data.id));
        g.attr("transform", `translate(${cur.x},${cur.y})`);
        if (fitsLabel(cur)) {
          text.attr("x", 6).attr("y", 14).style("display", "inline").text(labelFor(d, cur));
        } else {
          text.style("display", "none").text("");
        }
      });
    }

    // Background click drills out to root.
    svg
      .selectAll<SVGRectElement, unknown>("rect.vf-bg")
      .data([null])
      .join("rect")
      .attr("class", "vf-bg")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", this.width)
      .attr("height", this.height)
      .attr("fill", "transparent")
      .lower()
      .on("click", () => this.dataView?.setFocus(null));

    function labelFor(d: NodeData, layout: RectLayout): string {
      const name = d.vizNode?.name ?? d.data.id;
      const max = Math.max(1, Math.floor((layout.w - 12) / 6));
      return name.length > max ? name.slice(0, max) + "…" : name;
    }
  }
}

if (typeof customElements !== "undefined" && !customElements.get(VfIcicle.tag)) {
  customElements.define(VfIcicle.tag, VfIcicle);
}
