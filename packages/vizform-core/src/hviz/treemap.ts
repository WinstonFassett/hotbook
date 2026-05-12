import * as d3 from 'd3-hierarchy'
import { select } from 'd3-selection'
import { interpolateObject } from 'd3-interpolate'
import 'd3-transition'
import type { GoalTree, HVizCallbacks } from '../types'
import { motion } from '../viz/constants'

type Datum = GoalTree
type RNode = d3.HierarchyRectangularNode<Datum>

// Layout box stashed on each cell DOM element for transition-from-current
type Layout = { x: number; y: number; w: number; h: number }
type CellEl = SVGGElement & { __layout?: Layout }

const HEADER_H = 28
// Inner group header strip so the group label doesn't overlap child tiles
const GROUP_LABEL_H = 20
// Padding between group tile edge and child tiles
const CHILD_PAD = 3

function buildColorMap(tree: GoalTree): Map<string, string> {
  const m = new Map<string, string>()
  function walk(n: GoalTree) { m.set(n.id, n.color); n.children?.forEach(walk) }
  walk(tree)
  return m
}

function buildNameMap(tree: GoalTree): Map<string, string> {
  const m = new Map<string, string>()
  function walk(n: GoalTree) { m.set(n.id, n.name); n.children?.forEach(walk) }
  walk(tree)
  return m
}

export interface TreemapMounted {
  update(tree: GoalTree): void
  destroy(): void
}

export function mountTreemap(
  svgEl: SVGSVGElement,
  initialTree: GoalTree,
  callbacks: HVizCallbacks,
): TreemapMounted {
  let currentTree = initialTree
  let focusId = '__root__'

  function buildRoot(tree: GoalTree, w: number, bodyH: number): RNode {
    const root = d3.hierarchy<Datum>(tree)
      .sum(d => (d.children ? 0 : d.value))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    // paddingTop on inner groups makes room for the group label strip so child
    // tiles don't overlap the group name.
    d3.treemap<Datum>()
      .tile(d3.treemapSquarify)
      .size([w, bodyH])
      .paddingOuter(2)
      .paddingInner(1)
      .paddingTop(GROUP_LABEL_H + CHILD_PAD)
      .round(true)(root)

    return root as RNode
  }

  // Map a node's absolute treemap coords into SVG body space, relative to the
  // focused node. Returns pixel rect { x, y, w, h } in SVG body coordinates.
  function layoutOf(d: RNode, focus: RNode, w: number, bodyH: number): Layout {
    const fxr = Math.max(1e-9, focus.x1 - focus.x0)
    const fyr = Math.max(1e-9, focus.y1 - focus.y0)
    const sx = w / fxr
    const sy = bodyH / fyr
    return {
      x: (d.x0 - focus.x0) * sx,
      y: HEADER_H + (d.y0 - focus.y0) * sy,
      w: Math.max(0, (d.x1 - d.x0) * sx - 1),
      h: Math.max(0, (d.y1 - d.y0) * sy - 1),
    }
  }

  function render() {
    const tree = currentTree
    const svg = select(svgEl)
    const w = svgEl.clientWidth || 400
    const h = svgEl.clientHeight || 300
    const bodyH = Math.max(1, h - HEADER_H)
    svg.attr('viewBox', `0 0 ${w} ${h}`)

    const colorMap = buildColorMap(tree)
    const nameMap = buildNameMap(tree)
    const root = buildRoot(tree, w, bodyH)
    const focus = (root.descendants().find(d => d.data.id === focusId) ?? root) as RNode

    // Nodes to render: all descendants of focus, excluding focus itself and
    // excluding the synthetic __root__ node. Show two levels below focus
    // (groups + their leaves) — depth relative to focus <= 2.
    const focusDepth = focus.depth
    const all = (root.descendants() as RNode[]).filter(d =>
      d.data.id !== '__root__' &&
      d !== focus &&
      d.depth > focusDepth &&
      d.depth <= focusDepth + 2,
    )

    // --- Ensure structural DOM elements exist (defs, header, body) ---
    let defs = svg.select<SVGDefsElement>('defs')
    if (defs.empty()) defs = svg.append<SVGDefsElement>('defs')
    defs.selectAll('clipPath#htm-body-clip').data([null]).join(e =>
      e.append('clipPath').attr('id', 'htm-body-clip')
        .append('rect').attr('x', 0).attr('y', HEADER_H).attr('width', w).attr('height', bodyH)
        .selection(),
    )
    defs.select('clipPath#htm-body-clip rect')
      .attr('width', w).attr('height', bodyH)

    let headerG = svg.select<SVGGElement>('g.tm-header')
    if (headerG.empty()) {
      headerG = svg.append<SVGGElement>('g').attr('class', 'tm-header')
      headerG.append('rect').attr('class', 'tm-header-bg')
        .attr('x', 0).attr('y', 0).attr('height', HEADER_H)
        .attr('fill', 'oklch(0.16 0 0)')
      headerG.append('text').attr('class', 'tm-header-name')
        .attr('x', 8).attr('y', Math.round(HEADER_H * 0.65))
        .attr('font-size', 11).attr('font-weight', 500).attr('letter-spacing', '0.04em')
        .attr('fill', 'oklch(0.6 0 0)').attr('pointer-events', 'none')
      headerG.append('text').attr('class', 'tm-header-hint')
        .attr('y', Math.round(HEADER_H * 0.65))
        .attr('text-anchor', 'end').attr('font-size', 9).attr('letter-spacing', '0.08em')
        .attr('fill', 'oklch(0.45 0 0)').attr('pointer-events', 'none')
    }
    headerG.select('rect.tm-header-bg').attr('width', w)
    headerG.select('text.tm-header-hint').attr('x', w - 8)

    // Breadcrumb path
    const path: string[] = []
    let cur: RNode | null = focus
    while (cur && cur.data.id !== '__root__') {
      path.unshift(nameMap.get(cur.data.id) ?? cur.data.id)
      cur = cur.parent as RNode | null
    }
    headerG.select('text.tm-header-name').text(path.length ? path.join(' › ') : 'ALL')
    headerG.select('text.tm-header-hint').text(focus.depth > 0 ? '↑ ZOOM OUT' : '')
    headerG.attr('cursor', focus.depth > 0 ? 'pointer' : 'default')
    headerG.on('click', () => {
      if (focus.depth > 0) {
        focusId = focus.parent?.data.id ?? '__root__'
        render()
      }
    })

    let bodyG = svg.select<SVGGElement>('g.tm-body')
    if (bodyG.empty()) {
      bodyG = svg.append<SVGGElement>('g').attr('class', 'tm-body')
        .attr('clip-path', 'url(#htm-body-clip)')
    }

    // Background click drills out
    bodyG.selectAll<SVGRectElement, null>('rect.tm-bg').data([null]).join(
      e => e.append('rect').attr('class', 'tm-bg'),
    )
      .attr('x', 0).attr('y', HEADER_H).attr('width', w).attr('height', bodyH)
      .attr('fill', 'transparent')
      .on('click', () => {
        if (focus.depth > 0) {
          focusId = focus.parent?.data.id ?? '__root__'
          render()
        }
      })

    // --- Cell join: key by node id for continuity across renders ---
    const sel = bodyG.selectAll<CellEl, RNode>('g.tm-cell').data(all, d => d.data.id)

    const entered = sel.enter().append<CellEl>('g')
      .attr('class', 'tm-cell')
      .each(function(this: CellEl, d) {
        // New elements start from their computed final position (no stash = no
        // interpolation start, so they snap in — acceptable for initial render;
        // on subsequent renders existing elements will have __layout stashed).
        this.__layout = layoutOf(d, focus, w, bodyH)
      })

    // Group tile background
    entered.append('rect').attr('class', 'tm-rect')
    // Group label strip (only visible on group nodes, i.e. nodes with children)
    entered.append('rect').attr('class', 'tm-group-strip')
    // Name text
    entered.append('text').attr('class', 'tm-name')
    // Value text (leaves only)
    entered.append('text').attr('class', 'tm-val')

    const merged = entered.merge(sel)

    // Click: groups drill in; leaves invoke callback
    merged.attr('cursor', d => d.children ? 'pointer' : 'default')
    merged.on('click', (e, d) => {
      e.stopPropagation()
      if (d.children) {
        focusId = d.data.id
        render()
      } else {
        callbacks.onLeafClick?.(d.data.id)
      }
    })

    // Colors
    merged.select<SVGRectElement>('rect.tm-rect')
      .attr('fill', d => colorMap.get(d.data.id) ?? '#555')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 1)

    // Group label strip: the small header bar at top of each group tile
    merged.select<SVGRectElement>('rect.tm-group-strip')
      .attr('fill', d => d.children ? 'oklch(0 0 0 / 0.25)' : 'none')
      .attr('x', 0)
      .attr('y', 0)

    // Text labels — updated from current layout (end state) for sizing;
    // position is set inside the tween
    merged.select<SVGTextElement>('text.tm-name')
      .attr('fill', 'oklch(0.95 0 0)')
      .attr('font-size', 11).attr('font-weight', 500)
      .attr('pointer-events', 'none')

    merged.select<SVGTextElement>('text.tm-val')
      .attr('fill', 'oklch(0.95 0 0)')
      .attr('fill-opacity', 0.6).attr('font-size', 10)
      .attr('pointer-events', 'none')

    // Motion spec
    const mv = motion('move')

    // Animate each cell from its stashed __layout to the new computed layout
    merged
      .interrupt('layout')
      .transition('layout')
      .duration(mv.duration)
      .ease(mv.ease)
      .tween('layout', function(this: CellEl, d) {
        const end = layoutOf(d, focus, w, bodyH)
        const start = this.__layout ?? end
        const interp = interpolateObject(start, end) as (t: number) => Layout
        const g = select(this)
        const rect = g.select<SVGRectElement>('rect.tm-rect')
        const strip = g.select<SVGRectElement>('rect.tm-group-strip')
        const nameText = g.select<SVGTextElement>('text.tm-name')
        const valText = g.select<SVGTextElement>('text.tm-val')
        const isGroup = !!d.children

        return (t: number) => {
          const cur = interp(t)
          this.__layout = cur
          g.attr('transform', `translate(${cur.x},${cur.y})`)
          rect.attr('width', cur.w).attr('height', cur.h)

          if (isGroup) {
            // Group strip height: fixed strip at top of group tile
            const stripH = Math.min(GROUP_LABEL_H, cur.h)
            strip.attr('width', cur.w).attr('height', stripH)
            // Name in the strip
            if (cur.w >= 40 && cur.h >= 16) {
              const name = nameMap.get(d.data.id) ?? ''
              const maxChars = Math.max(1, Math.floor((cur.w - 10) / 6.5))
              nameText
                .attr('x', 5).attr('y', Math.min(14, stripH - 4))
                .text(name.length > maxChars ? name.slice(0, maxChars) + '…' : name)
            } else {
              nameText.text('')
            }
            valText.text('')
          } else {
            // Leaf tile
            strip.attr('width', 0).attr('height', 0)
            if (cur.w >= 36 && cur.h >= 20) {
              const name = nameMap.get(d.data.id) ?? ''
              const maxChars = Math.max(1, Math.floor((cur.w - 10) / 6.5))
              nameText
                .attr('x', 5).attr('y', 14)
                .text(name.length > maxChars ? name.slice(0, maxChars) + '…' : name)
            } else {
              nameText.text('')
            }
            if (cur.w >= 48 && cur.h >= 32) {
              const v = d.value ?? 0
              valText.attr('x', 5).attr('y', 26).text(`${Math.round(v)}`)
            } else {
              valText.text('')
            }
          }
        }
      })

    // Remove exited cells — animate them out by shrinking to zero size, then remove
    const ex = motion('exit')
    sel.exit()
      .interrupt('layout')
      .transition('layout')
      .duration(ex.duration)
      .ease(ex.ease)
      .tween('layout', function(this: CellEl) {
        const start = this.__layout ?? { x: 0, y: HEADER_H, w: 0, h: 0 }
        const end = { x: start.x + start.w / 2, y: start.y + start.h / 2, w: 0, h: 0 }
        const interp = interpolateObject(start, end) as (t: number) => Layout
        const g = select(this)
        const rect = g.select<SVGRectElement>('rect.tm-rect')
        return (t: number) => {
          const cur = interp(t)
          this.__layout = cur
          g.attr('transform', `translate(${cur.x},${cur.y})`)
          rect.attr('width', cur.w).attr('height', cur.h)
        }
      })
      .remove()
  }

  // Initial render — wipe any prior DOM content first
  select(svgEl).selectAll('*').remove()
  render()

  return {
    update(tree: GoalTree) {
      currentTree = tree
      render()
    },
    destroy() {
      select(svgEl).selectAll('*').remove()
    },
  }
}
