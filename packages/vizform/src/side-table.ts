import { effect } from "bireactive";
import type { VizNode } from "@hotbook/core";
import { DataView } from "./data-view.js";

/** VfSideTable — flat table on the same DataView as the icicle.
 *
 * - Editable cells publish `draft` events to the DataView.
 * - `input` events update the draft preview.
 * - `change` (blur/Enter) commits.
 * - Escape cancels and reverts.
 * - Updates in place: the focused input is not overwritten while the user is typing.
 */
export class VfSideTable extends HTMLElement {
  static tag = "vf-side-table";
  dataView: DataView | null = null;

  private table: HTMLTableElement | null = null;
  private tbody: HTMLTableSectionElement | null = null;
  private rowMap = new Map<string, HTMLTableRowElement>();
  private cleanup: (() => void) | null = null;

  connectedCallback() {
    if (!this.table) {
      this.table = document.createElement("table");
      this.table.style.cssText = "width:100%;border-collapse:collapse;";
      const thead = this.table.createTHead();
      const headerRow = thead.insertRow();
      const thName = document.createElement("th");
      thName.textContent = "Name";
      thName.style.cssText = "text-align:left;";
      const thValue = document.createElement("th");
      thValue.textContent = "Value";
      thValue.style.cssText = "text-align:left;";
      headerRow.appendChild(thName);
      headerRow.appendChild(thValue);
      this.tbody = this.table.createTBody();
      this.appendChild(this.table);
    }
    if (this.dataView) this.bind();
  }

  disconnectedCallback() {
    this.cleanup?.();
    this.cleanup = null;
  }

  setDataView(dataView: DataView) {
    this.dataView = dataView;
    if (this.isConnected) this.bind();
  }

  private bind() {
    this.cleanup?.();
    if (!this.dataView) return;
    this.cleanup = effect(() => {
      this.render();
    });
  }

  private render() {
    if (!this.tbody || !this.dataView) return;
    const dataView = this.dataView;
    const nodes = dataView.current.value;
    const cfg = dataView.config.value;
    const sort = dataView.effectiveSort.value;
    const measure = cfg.measure;

    const sorted = [...nodes].sort((a, b) => {
      if (sort === "value") {
        return (b.measures[measure] ?? 0) - (a.measures[measure] ?? 0);
      }
      return a.index - b.index;
    });

    const seen = new Set<string>();

    for (const n of sorted) {
      seen.add(n.id);
      let row = this.rowMap.get(n.id);
      if (!row) {
        row = this.tbody.insertRow();
        row.insertCell();
        const valueCell = row.insertCell();
        const input = document.createElement("input");
        input.type = "number";
        input.step = "any";
        input.style.cssText = "width:6em;";
        valueCell.appendChild(input);

        input.addEventListener("input", () => {
          const value = parseFloat(input.value);
          this.editNode(n.id, Number.isFinite(value) ? value : 0);
        });

        input.addEventListener("change", () => {
          this.dataView?.commit();
        });

        input.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            this.dataView?.cancel();
            input.blur();
          }
        });

        this.rowMap.set(n.id, row);
      }

      const cells = row.cells;
      cells[0].textContent = n.name;
      const input = cells[1].querySelector("input") as HTMLInputElement;
      if (document.activeElement !== input) {
        input.value = String(n.measures[measure] ?? 0);
      }
    }

    for (const [id, row] of this.rowMap) {
      if (!seen.has(id)) {
        row.remove();
        this.rowMap.delete(id);
      }
    }
  }

  private editNode(id: string, value: number) {
    const dataView = this.dataView;
    if (!dataView) return;
    const measure = dataView.config.value.measure;
    dataView.setDraft(
      "edit",
      (nodes) =>
        nodes.map((n) =>
          n.id === id
            ? { ...n, measures: { ...n.measures, [measure]: value } }
            : n
        ) as VizNode[],
      { id, value }
    );
  }
}

if (typeof customElements !== "undefined" && !customElements.get(VfSideTable.tag)) {
  customElements.define(VfSideTable.tag, VfSideTable);
}
