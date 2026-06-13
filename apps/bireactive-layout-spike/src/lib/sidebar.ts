// Property-editor sidebar. Modest start: shows the selected node /
// group / edge, lets you rename or delete it. Plugs into sharedSelection
// + sharedRows + sharedEdges; the diagram re-renders via existing
// effects on the shared colls.
//
// Re-renders the sidebar HTML on any change to selection, sharedRows,
// or sharedEdges so renamed labels and deleted ids reflect immediately.

import { effect } from "@bireactive";

import { descendantsOf, sharedEdges, sharedRows } from "./data";
import { clearSelection, sharedSelection } from "./selection";

export function mountSidebar(host: HTMLElement): () => void {
  host.innerHTML = "";
  const wrap = document.createElement("aside");
  wrap.className = "sidebar";
  wrap.style.cssText = [
    "min-width:240px",
    "max-width:280px",
    "padding:12px 14px",
    "border:1px solid var(--border)",
    "border-radius:6px",
    "background:color-mix(in srgb, var(--bg) 70%, transparent)",
    "font-size:13px",
    "align-self:flex-start",
  ].join(";");
  host.appendChild(wrap);

  const dispose = effect(() => {
    // Subscribe to selection + colls so we re-render when any change.
    const sel = sharedSelection.value;
    const rows = sharedRows.items;
    const edges = sharedEdges.items;

    if (!sel) {
      wrap.innerHTML = `<div style="color:var(--muted)">Nothing selected.<br/>Click a node, group, or edge.</div>`;
      return;
    }

    if (sel.kind === "edge") {
      const e = edges.find((x) => x.id === sel.id);
      if (!e) {
        clearSelection();
        return;
      }
      wrap.innerHTML = `
        <div style="font-weight:600;margin-bottom:8px">edge · ${escape(e.id)}</div>
        <div style="color:var(--muted);margin-bottom:8px">${escape(e.from.value)} → ${escape(e.to.value)}</div>
        <button data-act="delete" style="margin-top:8px">delete edge</button>
      `;
      bindDelete(wrap, () => {
        sharedEdges.remove(e);
        clearSelection();
      });
      return;
    }

    // node or group — same Row table
    const row = rows.find((r) => r.id === sel.id);
    if (!row) {
      clearSelection();
      return;
    }
    const isGroup = rows.some((r) => r.parentId.value === row.id);
    const parent = row.parentId.value;
    const descCount = isGroup ? descendantsOf(sharedRows, row.id).size : 0;
    wrap.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">${isGroup ? "group" : "node"} · ${escape(row.id)}</div>
      <label style="display:block;margin-bottom:8px">
        <div style="color:var(--muted);font-size:11px">name</div>
        <input data-field="name" value="${escape(row.name.value)}"
          style="width:100%;padding:4px 6px;font:inherit;border:1px solid var(--border);background:transparent;color:var(--fg);border-radius:4px"/>
      </label>
      <div style="margin-bottom:8px">
        <div style="color:var(--muted);font-size:11px">parent</div>
        <div>${parent == null ? "<i>(root)</i>" : escape(parent)}</div>
      </div>
      ${
        isGroup
          ? `<button data-act="delete-promote" style="margin-top:4px;display:block;margin-bottom:6px">delete grouping · keep children</button>
             <button data-act="delete-cascade" style="display:block">delete group + ${descCount} descendant${descCount === 1 ? "" : "s"}</button>`
          : `<button data-act="delete" style="margin-top:4px">delete node</button>`
      }
    `;

    const input = wrap.querySelector<HTMLInputElement>('[data-field="name"]');
    if (input) {
      input.addEventListener("input", () => {
        row.name.value = input.value;
      });
    }
    if (isGroup) {
      bindBtn(wrap, "delete-promote", () => {
        for (const e of [...sharedEdges.items]) {
          if (e.from.value === row.id || e.to.value === row.id) sharedEdges.remove(e);
        }
        for (const r of [...sharedRows.items]) {
          if (r.parentId.value === row.id) r.parentId.value = parent;
        }
        sharedRows.remove(row);
        clearSelection();
      });
      bindBtn(wrap, "delete-cascade", () => {
        const doomed = new Set<string>([row.id, ...descendantsOf(sharedRows, row.id)]);
        for (const e of [...sharedEdges.items]) {
          if (doomed.has(e.from.value) || doomed.has(e.to.value)) sharedEdges.remove(e);
        }
        for (const r of [...sharedRows.items]) {
          if (doomed.has(r.id)) sharedRows.remove(r);
        }
        clearSelection();
      });
    } else {
      bindDelete(wrap, () => {
        for (const e of [...sharedEdges.items]) {
          if (e.from.value === row.id || e.to.value === row.id) sharedEdges.remove(e);
        }
        sharedRows.remove(row);
        clearSelection();
      });
    }
  });

  return () => {
    dispose();
    host.innerHTML = "";
  };
}

function bindDelete(wrap: HTMLElement, run: () => void): void {
  bindBtn(wrap, "delete", run);
}

function bindBtn(wrap: HTMLElement, act: string, run: () => void): void {
  const btn = wrap.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
  if (!btn) return;
  btn.style.cssText = [
    "padding:4px 10px",
    "font:inherit",
    "cursor:pointer",
    "border:1px solid var(--border)",
    "background:transparent",
    "color:var(--fg)",
    "border-radius:4px",
  ].join(";");
  btn.addEventListener("click", run);
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
