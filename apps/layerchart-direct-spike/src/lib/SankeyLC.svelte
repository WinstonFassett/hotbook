<svelte:options customElement="lc-sankey-lc" />

<!--
  Sankey diagram via d3-sankey. Flow graph — not a tree, no sharedTree.
  Nodes rendered as <Rect>, links as <Link sankey>, labels as inline <text>.
  Hover highlights connected links; click node to isolate its subgraph.
-->

<script lang="ts">
  import { type SankeyNode, type SankeyLink } from "d3-sankey";
  import { Chart, Svg, Sankey, Link, Rect, Group } from "layerchart";

  let { width = 600, height = 400 }: { width?: number; height?: number } = $props();

  const data = {
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

  type N = { id: string };
  type L = { source: string; target: string; value: number };

  let highlightedLinkIndexes = $state<Set<number>>(new Set());

  function highlightNode(node: SankeyNode<N, L>) {
    const idxs = new Set<number>();
    (node.sourceLinks ?? []).forEach((l: any) => idxs.add(l.index));
    (node.targetLinks ?? []).forEach((l: any) => idxs.add(l.index));
    highlightedLinkIndexes = idxs;
  }

  function clearHighlight() {
    highlightedLinkIndexes = new Set();
  }
</script>

<div style="width: {width}px; height: {height}px;">
  <Chart {data} {width} {height} padding={{ left: 4, right: 60, top: 4, bottom: 4 }}>
    <Svg>
      <Sankey nodeId={(d: any) => d.id} nodeWidth={10} nodePadding={8} let:nodes let:links>
        {#each links as link ([link.source.id, link.target.id].join("→"))}
          {@const lk = link as SankeyLink<N, L> & { index: number }}
          <Link
            sankey
            data={link}
            strokeWidth={link.width}
            stroke="#6ab0f5"
            stroke-opacity={highlightedLinkIndexes.size === 0 || highlightedLinkIndexes.has(lk.index) ? 0.18 : 0.04}
            tweened
          />
        {/each}
        {#each nodes as node (node.id)}
          {@const n = node as SankeyNode<N, L>}
          {@const nw = (n.x1 ?? 0) - (n.x0 ?? 0)}
          {@const nh = (n.y1 ?? 0) - (n.y0 ?? 0)}
          {@const isTarget = (n.targetLinks?.length ?? 0) === 0}
          <Group
            x={n.x0}
            y={n.y0}
            onpointerenter={() => highlightNode(n)}
            onpointerleave={clearHighlight}
          >
            <Rect
              width={nw}
              height={nh}
              fill="#6ab0f5"
              fillOpacity={0.85}
              rx={2}
            />
          </Group>
          <text
            x={isTarget ? (n.x0 ?? 0) - 4 : (n.x1 ?? 0) + 4}
            y={(n.y0 ?? 0) + nh / 2}
            text-anchor={isTarget ? "end" : "start"}
            dominant-baseline="middle"
            font-size="11"
            fill="#cdd5e0"
            pointer-events="none"
          >{n.id}</text>
        {/each}
      </Sankey>
    </Svg>
  </Chart>
</div>
