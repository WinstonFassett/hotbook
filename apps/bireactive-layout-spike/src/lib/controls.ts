// Shared mutation toolbar. Mounted once above the tab strip so every
// spike sees mutations on the same Coll<Row> + Coll<Edge>. Since the
// spikes auto-react to Coll changes, the diagrams all re-derive
// together — the same intent (add/reparent/remove) lands as a different
// layout on each tab.

import { descendantsOf, makeEdge, makeRow, sharedEdges, sharedRows, leafIds, containerIds, flatGraph } from "./data";

let counter = 100; // start above the seed ids so we don't collide

interface Action {
  id: string;
  label: string;
  run: () => void;
}

const ACTIONS: Action[] = [
  {
    id: "add-node",
    label: "+ node",
    run: () => {
      const id = `n${++counter}`;
      const containers = containerIds(sharedRows);
      const parent = containers.length > 0
        ? containers[Math.floor(Math.random() * containers.length)]!
        : null;
      sharedRows.insert(makeRow(id, parent, sharedRows.items.length));
    },
  },
  {
    id: "add-container",
    label: "+ container",
    run: () => {
      const gid = `g${++counter}`;
      const tops = sharedRows.items.filter((r) => r.parentId.value === null);
      const parent = tops.length > 1
        ? tops[Math.floor(Math.random() * tops.length)]!.id
        : null;
      sharedRows.insert(makeRow(gid, parent, sharedRows.items.length));
      // Seed one child so the new container has shape immediately.
      const childId = `n${++counter}`;
      sharedRows.insert(makeRow(childId, gid, 0));
    },
  },
  {
    id: "add-edge",
    label: "+ edge",
    run: () => {
      const items = sharedRows.items;
      if (items.length < 2) return;
      const a = items[Math.floor(Math.random() * items.length)]!;
      let b = items[Math.floor(Math.random() * items.length)]!;
      let guard = 8;
      while (
        guard-- > 0 &&
        (b.id === a.id ||
          sharedEdges.items.some((e) => e.from.value === a.id && e.to.value === b.id))
      ) {
        b = items[Math.floor(Math.random() * items.length)]!;
      }
      if (b.id !== a.id) sharedEdges.insert(makeEdge(a.id, b.id));
    },
  },
  {
    id: "reparent",
    label: "reparent",
    run: () => {
      const items = sharedRows.items;
      if (items.length === 0) return;
      const row = items[Math.floor(Math.random() * items.length)]!;
      const desc = descendantsOf(sharedRows, row.id);
      const candidates = items.filter(
        (r) => r.id !== row.id && !desc.has(r.id) && r.parentId.value !== row.id,
      );
      if (candidates.length === 0) return;
      const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
      row.parentId.value = Math.random() < 0.2 ? null : pick.id;
    },
  },
  {
    id: "rm-container",
    label: "− container",
    run: () => {
      // Find a container (row with children). Removing it re-parents its
      // direct children to the container's own parent so we don't orphan
      // subtrees.
      const items = sharedRows.items;
      const hasChild = new Set<string>();
      for (const r of items) {
        const pid = r.parentId.value;
        if (pid != null) hasChild.add(pid);
      }
      const containers = items.filter((r) => hasChild.has(r.id));
      if (containers.length === 0) return;
      // Prefer a non-root container so we keep at least one nesting
      // level around; fall back to any container.
      const nonRoot = containers.filter((r) => r.parentId.value != null);
      const victim = (nonRoot.length > 0 ? nonRoot : containers)[
        Math.floor(Math.random() * (nonRoot.length > 0 ? nonRoot.length : containers.length))
      ]!;
      const grandparent = victim.parentId.value;
      // Re-parent direct children to the victim's parent.
      for (const r of items) {
        if (r.parentId.value === victim.id) r.parentId.value = grandparent;
      }
      // Drop edges that touch the container itself.
      for (const e of [...sharedEdges.items]) {
        if (e.from.value === victim.id || e.to.value === victim.id) sharedEdges.remove(e);
      }
      sharedRows.remove(victim);
    },
  },
  {
    id: "rm-edge",
    label: "− edge",
    run: () => {
      const items = sharedEdges.items;
      if (items.length === 0) return;
      sharedEdges.remove(items[items.length - 1]!);
    },
  },
  {
    id: "rm-node",
    label: "− node",
    run: () => {
      const items = sharedRows.items;
      if (items.length <= 1) return;
      const hasChild = new Set(items.map((r) => r.parentId.value).filter(Boolean) as string[]);
      const victim =
        [...items].reverse().find((r) => !hasChild.has(r.id)) ?? items[items.length - 1]!;
      for (const e of [...sharedEdges.items]) {
        if (e.from.value === victim.id || e.to.value === victim.id) sharedEdges.remove(e);
      }
      sharedRows.remove(victim);
    },
  },
  {
    id: "log",
    label: "log",
    run: () => {
      const fmt = (s: string | null): string =>
        s === null ? "null" : JSON.stringify(s);
      const rowLines = sharedRows.items.map(
        (r) =>
          `  makeRow(${JSON.stringify(r.id)}, ${fmt(r.parentId.value)}, ${r.index.value}, ${JSON.stringify(r.name.value)}),`,
      );
      const edgeLines = sharedEdges.items.map(
        (e) => `  makeEdge(${JSON.stringify(e.from.value)}, ${JSON.stringify(e.to.value)}),`,
      );
      const out = [
        "const SEED_ROWS: Row[] = [",
        ...rowLines,
        "];",
        "",
        "const SEED_EDGES: Edge[] = [",
        ...edgeLines,
        "];",
      ].join("\n");
      console.log(out);
      void navigator.clipboard?.writeText(out).catch(() => {});
    },
  },
];

/** Mount the shared controls into `host`. Returns a disposer. */
export function mountControls(host: HTMLElement): () => void {
  host.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "shared-controls";
  wrap.style.cssText = [
    "display:flex",
    "gap:6px",
    "align-items:center",
    "flex-wrap:wrap",
    "font-size:13px",
    "padding:10px 0",
  ].join(";");
  for (const a of ACTIONS) {
    const btn = document.createElement("button");
    btn.dataset.act = a.id;
    btn.textContent = a.label;
    wrap.appendChild(btn);
  }
  const status = document.createElement("span");
  status.className = "status";
  status.style.cssText = "color:var(--muted);margin-left:8px";
  wrap.appendChild(status);
  host.appendChild(wrap);

  const updateStatus = (): void => {
    const fg = flatGraph(sharedRows, sharedEdges);
    const leafCount = leafIds(sharedRows).length;
    const containerCount = fg.nodes.length - leafCount;
    status.textContent = `${fg.nodes.length} rows (${leafCount} leaves, ${containerCount} containers) · ${fg.edges.length} edges`;
  };
  updateStatus();

  const onClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement;
    const act = t.dataset?.act;
    if (!act) return;
    const action = ACTIONS.find((a) => a.id === act);
    if (!action) return;
    action.run();
    updateStatus();
  };
  wrap.addEventListener("click", onClick);

  return () => {
    wrap.removeEventListener("click", onClick);
    host.innerHTML = "";
  };
}
