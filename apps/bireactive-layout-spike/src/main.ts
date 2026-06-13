// Bireactive layout-backends spike entry.
// Four tabs: propagator-Sugiyama (incremental), force-via-constraints (adapt),
// dagre wrap (regime: pure-fn), CoLa skeleton (adapt — separation+nonOverlap).
//
// Every spike except the dagre wrap is a `Diagram` subclass and auto-registers
// its custom element on `.define()`. The dagre tab is plain SVG since the
// regime under test is "no bireactive involved on the layout side".

import { MdPropSugiyama } from "./lib/spike1-prop-sugiyama";
import { MdForceAdapt } from "./lib/spike3-force-adapt";
import { MdDagreWrap } from "./lib/spike4-dagre-wrap";
import { MdColaAdapt } from "./lib/spike2-cola-adapt";
import { MdNestedLayered } from "./lib/spike5-nested-layered";
import { mountControls } from "./lib/controls";

MdPropSugiyama.define();
MdForceAdapt.define();
MdDagreWrap.define();
MdColaAdapt.define();
MdNestedLayered.define();

interface SpikeDef {
  id: string;
  label: string;
  blurb: string;
  mount: (root: HTMLElement) => void;
}

const spikes: SpikeDef[] = [
  {
    id: "spike1",
    label: "1 · Propagator-Sugiyama (incremental)",
    blurb:
      "Layer assignment via interval-narrowing on bireactive's propagator solver. Add/remove edges live — the layer cells re-narrow, only affected nodes move. Counter-example to 'no incremental Sugiyama in OSS JS'.",
    mount: root => {
      root.innerHTML = '<md-prop-sugiyama style="--d-w: 720"></md-prop-sugiyama>';
    },
  },
  {
    id: "spike3",
    label: "3 · Force-via-constraints (adapt)",
    blurb:
      "FR-style force layout entirely in bireactive's AVBD constraint cluster: spring + repel + gap + softTarget + physics(). Lifted from inspo/bireactive/site/elements/md-graph.ts. No d3-force, no ngraph — the substrate does it natively.",
    mount: root => {
      root.innerHTML = '<md-force-adapt style="--d-w: 620"></md-force-adapt>';
    },
  },
  {
    id: "spike4",
    label: "4 · Dagre wrap (pure-fn regime)",
    blurb:
      "Dagre lays out the leaves; containers become derived hulls (same as Spike 1). Same shared data, same renderer — only the layout algorithm differs. The wrap regime: snapshot in, positions out, springs animate to target.",
    mount: root => {
      root.innerHTML = '<md-dagre-wrap style="--d-w: 760"></md-dagre-wrap>';
    },
  },
  {
    id: "spike2",
    label: "2 · CoLa skeleton (separation + nonOverlap)",
    blurb:
      "Adds two CoLa-specific constraint factories on top of bireactive's existing spring/repel/gap: separation(axis, gap) and rectNonOverlap. Small demo with clustered nodes + axis-aligned separation. Foundation for a future bireactive-cola package.",
    mount: root => {
      root.innerHTML = '<md-cola-adapt style="--d-w: 620"></md-cola-adapt>';
    },
  },
  {
    id: "spike5",
    label: "5 · Nested-layered (recursive)",
    blurb:
      "layered() solved per group, recursively. Each child group appears to its parent's solve as a fat node sized by its inner extent + chrome. Same primitive at every nesting level — no compound engine, no post-process. Cross-containment edges render leaf-to-leaf but only influence layout at their LCA.",
    mount: root => {
      root.innerHTML = '<md-nested-layered style="--d-w: 760"></md-nested-layered>';
    },
  },
];

const nav = document.getElementById("nav")!;
const main = document.getElementById("main")!;
const toolbar = document.getElementById("toolbar")!;
mountControls(toolbar);

function show(id: string): void {
  for (const s of spikes) {
    const btn = document.getElementById(`btn-${s.id}`);
    if (btn) btn.classList.toggle("active", s.id === id);
  }
  const spike = spikes.find(s => s.id === id);
  if (!spike) return;
  main.innerHTML = `
    <section class="spike active" id="sect-${spike.id}">
      <h2>${spike.label}</h2>
      <p class="blurb">${spike.blurb}</p>
      <div class="stage" id="stage-${spike.id}"></div>
    </section>
  `;
  const stage = document.getElementById(`stage-${spike.id}`)!;
  spike.mount(stage);
  history.replaceState(null, "", `#${spike.id}`);
}

for (const s of spikes) {
  const btn = document.createElement("button");
  btn.id = `btn-${s.id}`;
  btn.textContent = s.label;
  btn.onclick = () => show(s.id);
  nav.appendChild(btn);
}

const initial = location.hash.slice(1) || spikes[0]!.id;
show(spikes.find(s => s.id === initial) ? initial : spikes[0]!.id);
