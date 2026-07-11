// Nested-layered layout demo — recursive group layout.
//
// MdNestedLayered applies layered() per group, recursively. Each child group
// appears to its parent's solve as a fat node sized by its inner extent +
// chrome. Same primitive at every nesting level — no compound engine, no
// post-process. Cross-containment edges render leaf-to-leaf but only
// influence layout at their LCA.

import { MdNestedLayered, setLayoutData } from "@hotbook/layout";
import { mountControls } from "./controls";
import { mountSidebar } from "./sidebar";
import { sharedRows, sharedEdges } from "./demo-data";

// Configure the layout component with demo data
setLayoutData(sharedRows, sharedEdges);

MdNestedLayered.define();

const toolbar = document.getElementById("toolbar")!;
const main = document.getElementById("main")!;

mountControls(toolbar);

main.innerHTML = `
  <section class="demo active">
    <h2>Nested-layered (recursive)</h2>
    <p class="blurb">
      layered() solved per group, recursively. Each child group appears to its
      parent's solve as a fat node sized by its inner extent + chrome. Same
      primitive at every nesting level — no compound engine, no post-process.
      Cross-containment edges render leaf-to-leaf but only influence layout at
      their LCA.
    </p>
    <div class="layout" style="display:flex;gap:16px;align-items:flex-start">
      <div class="stage" id="stage" style="flex:1;min-width:0"></div>
      <div id="sidebar"></div>
    </div>
  </section>
`;

const stage = document.getElementById("stage")!;
stage.innerHTML = '<md-nested-layered style="--d-w: 760"></md-nested-layered>';

const sidebarHost = document.getElementById("sidebar")!;
mountSidebar(sidebarHost);
