// Property-editor sidebar.
//
// Architectural note: the panel HTML is rebuilt only when the SELECTION
// IDENTITY changes (kind + id), not on every keystroke. Inputs bind to
// their cells via separate effects, so typing into the name field
// doesn't tear down and re-create the input (which would lose focus).
//
// Pure DOM, no framework — bireactive's effect() does the reactivity.

import { effect } from "bireactive";

import { descendantsOf, type Edge, type Row } from "@fiddleviz/layout";
import { sharedEdges, sharedRows, items, removeRow, removeEdge } from "./demo-data";
import { clearSelection, sharedSelection } from "@fiddleviz/layout";

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

  // Disposers for the currently-mounted panel's input/button bindings
  // and reactive effects. Cleared and rebuilt whenever the selection
  // identity changes.
  let panelDisposers: Array<() => void> = [];
  let lastKey = "";

  const tearDownPanel = (): void => {
    for (const d of panelDisposers) d();
    panelDisposers = [];
  };

  const renderEmpty = (): void => {
    wrap.innerHTML = `<div style="color:var(--muted)">Nothing selected.<br/>Click a node, group, or edge.</div>`;
  };

  const dispose = effect(() => {
    const sel = sharedSelection.value;
    const rows = items(sharedRows);
    const edges = items(sharedEdges);

    // Key changes only when the selected entity (kind+id) changes —
    // OR when an entity is added/removed (the find below might newly
    // resolve/fail). Track existence by including it in the key.
    let key = sel ? `${sel.kind}:${sel.id}` : "";
    if (sel) {
      const found =
        sel.kind === "edge"
          ? edges.some((e) => e.id === sel.id)
          : rows.some((r) => r.id === sel.id);
      if (!found) key = "missing";
    }
    // Also re-render when row's group-ness flips (children added/removed)
    // so the group-only controls appear/disappear correctly.
    if (sel && sel.kind !== "edge") {
      const isGroup = rows.some((r) => r.parentId.value === sel.id);
      key += `:${isGroup ? "g" : "n"}`;
    }

    if (key === lastKey) return; // identity unchanged → leave DOM alone
    lastKey = key;
    tearDownPanel();

    if (!sel) {
      renderEmpty();
      return;
    }
    if (key === "missing") {
      // Entity was deleted out from under us — clear selection. This
      // triggers another effect run; lastKey reset to "".
      renderEmpty();
      lastKey = "";
      clearSelection();
      return;
    }

    if (sel.kind === "edge") {
      const e = edges.find((x) => x.id === sel.id)!;
      renderEdgePanel(wrap, e, panelDisposers);
    } else {
      const row = rows.find((r) => r.id === sel.id)!;
      const isGroup = rows.some((r) => r.parentId.value === row.id);
      renderRowPanel(wrap, row, isGroup, panelDisposers);
    }
  });

  return () => {
    tearDownPanel();
    dispose();
    host.innerHTML = "";
  };
}

function renderEdgePanel(wrap: HTMLElement, e: Edge, disposers: Array<() => void>): void {
  wrap.innerHTML = `
    <div style="font-weight:600;margin-bottom:8px">edge · ${escape(e.id)}</div>
    <div style="color:var(--muted);margin-bottom:8px">${escape(e.from.value)} → ${escape(e.to.value)}</div>
    <label style="display:block;margin-bottom:8px">
      <div style="color:var(--muted);font-size:11px">label</div>
      <input data-field="label"
        placeholder="(none)"
        style="width:100%;padding:4px 6px;font:inherit;border:1px solid var(--border);background:transparent;color:var(--fg);border-radius:4px"/>
    </label>
    <button data-act="delete" style="margin-top:8px">delete edge</button>
  `;
  bindInput(wrap, "label", e.label, disposers);
  bindBtn(wrap, "delete", () => {
    removeEdge(e);
    clearSelection();
  });
}

function renderRowPanel(
  wrap: HTMLElement,
  row: Row,
  isGroup: boolean,
  disposers: Array<() => void>,
): void {
  const parent = row.parentId.value;
  const descCount = isGroup ? descendantsOf(sharedRows, row.id).size : 0;
  wrap.innerHTML = `
    <div style="font-weight:600;margin-bottom:8px">${isGroup ? "group" : "node"} · ${escape(row.id)}</div>
    <label style="display:block;margin-bottom:8px">
      <div style="color:var(--muted);font-size:11px">name</div>
      <input data-field="name"
        style="width:100%;padding:4px 6px;font:inherit;border:1px solid var(--border);background:transparent;color:var(--fg);border-radius:4px"/>
    </label>
    <div style="margin-bottom:8px">
      <div style="color:var(--muted);font-size:11px">parent</div>
      <div>${parent == null ? "<i>(root)</i>" : escape(parent)}</div>
    </div>
    ${
      isGroup
        ? `<label style="display:block;margin-bottom:10px">
             <div style="color:var(--muted);font-size:11px">direction</div>
             <select data-field="direction"
               style="font:inherit;padding:2px 4px;background:transparent;color:var(--fg);border:1px solid var(--border);border-radius:4px">
               <option value="">(inherit)</option>
               <option value="TB">TB</option>
               <option value="LR">LR</option>
             </select>
           </label>
           <button data-act="delete-promote" style="display:block;margin-bottom:6px">delete grouping · keep children</button>
           <button data-act="delete-cascade" style="display:block">delete group + ${descCount} descendant${descCount === 1 ? "" : "s"}</button>`
        : `<button data-act="delete" style="margin-top:4px">delete node</button>`
    }
  `;

  bindInput(wrap, "name", row.name, disposers);

  if (isGroup) {
    bindSelect(wrap, "direction", row.direction, disposers);
    bindBtn(wrap, "delete-promote", () => {
      for (const e of [...items(sharedEdges)]) {
        if (e.from.value === row.id || e.to.value === row.id) removeEdge(e);
      }
      for (const r of [...items(sharedRows)]) {
        if (r.parentId.value === row.id) r.parentId.value = parent;
      }
      removeRow(row);
      clearSelection();
    });
    bindBtn(wrap, "delete-cascade", () => {
      const doomed = new Set<string>([row.id, ...descendantsOf(sharedRows, row.id)]);
      for (const e of [...items(sharedEdges)]) {
        if (doomed.has(e.from.value) || doomed.has(e.to.value)) removeEdge(e);
      }
      for (const r of [...items(sharedRows)]) {
        if (doomed.has(r.id)) removeRow(r);
      }
      clearSelection();
    });
  } else {
    bindBtn(wrap, "delete", () => {
      for (const e of [...items(sharedEdges)]) {
        if (e.from.value === row.id || e.to.value === row.id) removeEdge(e);
      }
      removeRow(row);
      clearSelection();
    });
  }
}

/** Two-way bind a text input to a writable string cell. The input's
 *  value is set imperatively from the cell on mount and on subsequent
 *  cell changes (e.g. external rename). Typing updates the cell. */
function bindInput(
  wrap: HTMLElement,
  field: string,
  cell: { value: string },
  disposers: Array<() => void>,
): void {
  const inp = wrap.querySelector<HTMLInputElement>(`[data-field="${field}"]`);
  if (!inp) return;
  // Push cell → input only when value differs from what the user
  // currently has typed. This subscribes via effect so external edits
  // propagate, but doesn't disturb focus / caret while typing.
  const eff = effect(() => {
    const v = cell.value;
    if (inp !== document.activeElement && inp.value !== v) inp.value = v;
    else if (inp.value === "" && v !== "") inp.value = v;
  });
  const onInput = (): void => {
    cell.value = inp.value;
  };
  inp.addEventListener("input", onInput);
  disposers.push(() => {
    inp.removeEventListener("input", onInput);
    eff();
  });
}

function bindSelect(
  wrap: HTMLElement,
  field: string,
  cell: { value: "TB" | "LR" | null },
  disposers: Array<() => void>,
): void {
  const sel = wrap.querySelector<HTMLSelectElement>(`[data-field="${field}"]`);
  if (!sel) return;
  const eff = effect(() => {
    const v = cell.value ?? "";
    if (sel.value !== v) sel.value = v;
  });
  const onChange = (): void => {
    cell.value = sel.value === "" ? null : (sel.value as "TB" | "LR");
  };
  sel.addEventListener("change", onChange);
  disposers.push(() => {
    sel.removeEventListener("change", onChange);
    eff();
  });
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
