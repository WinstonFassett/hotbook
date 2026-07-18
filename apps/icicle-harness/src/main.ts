// main.ts — wire up the harness.
// Create a Kernel, register a Dataset, give the icicle and side table the
// same Kernel + config (so they share the DataView).

import type { ChartConfig, Dataset, DataNode } from "./types";
import { Kernel } from "./kernel";
import "./icicle-chart.ts";
import "./side-table.ts";

// ─── Sample hierarchical data ──────────────────────────────────────────────

const sampleData: DataNode = {
  id: "root",
  label: "Budget",
  value: 0,
  children: [
    {
      id: "housing",
      label: "Housing",
      value: 0,
      color: "oklch(0.6 0.12 240)",
      children: [
        {
          id: "rent",
          label: "Rent",
          value: 0,
          color: "oklch(0.6 0.12 240)",
          children: [
            { id: "rent-base", label: "Base rent", value: 1800, color: "oklch(0.6 0.12 240)", children: [
              { id: "rent-base-lease", label: "Lease", value: 1700, color: "oklch(0.6 0.12 240)", children: [] },
              { id: "rent-base-fees", label: "Fees", value: 100, color: "oklch(0.65 0.12 240)", children: [] },
            ] },
            { id: "rent-parking", label: "Parking spot", value: 400, color: "oklch(0.65 0.12 240)", children: [] },
          ],
        },
        {
          id: "utilities",
          label: "Utilities",
          value: 0,
          color: "oklch(0.65 0.12 240)",
          children: [
            { id: "electric", label: "Electric", value: 180, color: "oklch(0.65 0.12 240)", children: [] },
            { id: "water", label: "Water", value: 80, color: "oklch(0.7 0.12 240)", children: [] },
            { id: "internet", label: "Internet", value: 120, color: "oklch(0.75 0.12 240)", children: [] },
          ],
        },
        { id: "insurance", label: "Insurance", value: 180, color: "oklch(0.7 0.12 240)", children: [] },
      ],
    },
    {
      id: "food",
      label: "Food",
      value: 0,
      color: "oklch(0.6 0.12 120)",
      children: [
        {
          id: "groceries",
          label: "Groceries",
          value: 0,
          color: "oklch(0.6 0.12 120)",
          children: [
            { id: "produce", label: "Produce", value: 240, color: "oklch(0.6 0.12 120)", children: [] },
            { id: "protein", label: "Protein", value: 220, color: "oklch(0.65 0.12 120)", children: [] },
            { id: "pantry", label: "Pantry", value: 160, color: "oklch(0.7 0.12 120)", children: [] },
          ],
        },
        {
          id: "dining",
          label: "Dining out",
          value: 0,
          color: "oklch(0.65 0.12 120)",
          children: [
            { id: "lunch", label: "Lunch", value: 180, color: "oklch(0.65 0.12 120)", children: [] },
            { id: "dinner", label: "Dinner", value: 160, color: "oklch(0.7 0.12 120)", children: [] },
          ],
        },
      ],
    },
    {
      id: "transport",
      label: "Transport",
      value: 0,
      color: "oklch(0.6 0.12 40)",
      children: [
        {
          id: "gas",
          label: "Gas",
          value: 0,
          color: "oklch(0.6 0.12 40)",
          children: [
            { id: "gas-commute", label: "Commute", value: 200, color: "oklch(0.6 0.12 40)", children: [] },
            { id: "gas-trips", label: "Trips", value: 80, color: "oklch(0.65 0.12 40)", children: [] },
          ],
        },
        { id: "transit", label: "Transit", value: 120, color: "oklch(0.65 0.12 40)", children: [] },
        { id: "parking", label: "Parking", value: 60, color: "oklch(0.7 0.12 40)", children: [] },
      ],
    },
    {
      id: "savings",
      label: "Savings",
      value: 0,
      color: "oklch(0.6 0.12 200)",
      children: [
        {
          id: "emergency",
          label: "Emergency fund",
          value: 0,
          color: "oklch(0.6 0.12 200)",
          children: [
            { id: "emergency-monthly", label: "Monthly", value: 300, color: "oklch(0.6 0.12 200)", children: [] },
            { id: "emergency-buffer", label: "Buffer", value: 200, color: "oklch(0.65 0.12 200)", children: [] },
          ],
        },
        {
          id: "retire",
          label: "Retirement",
          value: 0,
          color: "oklch(0.65 0.12 200)",
          children: [
            { id: "retire-401k", label: "401k", value: 500, color: "oklch(0.65 0.12 200)", children: [] },
            { id: "retire-ira", label: "IRA", value: 300, color: "oklch(0.7 0.12 200)", children: [] },
          ],
        },
      ],
    },
  ],
};

const dataset: Dataset = {
  id: "budget",
  dataShape: "hierarchical",
  root: sampleData,
};

const config: ChartConfig = {
  datasetId: "budget",
  measure: "value",
  sort: "value",
  depth: 3,
  orientation: "vertical",
  canReorder: false,
  conservationMode: "proportional-neighbor",
};
// Tree is now 5 levels deep (root → category → subcategory → item → detail).
// depth:3 shows root + 2 levels; drilling into a category reveals its
// subcategories + items, drilling again reveals items + details.

// ─── Wire up ───────────────────────────────────────────────────────────────

const kernel = new Kernel();
kernel.registerDataset(dataset);

const icicle = document.querySelector("v-icicle") as any;
const table = document.querySelector("v-side-table") as any;

icicle.kernel = kernel;
icicle.config = config;
table.kernel = kernel;
table.config = config;

// Config bar: push config changes to both components (recreates DataView → animated transition).
function updateConfig(key: keyof ChartConfig, value: any) {
  (config as any)[key] = value;
  icicle.config = config;
  table.config = config;
}

document.querySelectorAll("#config-bar button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const cfg = btn.getAttribute("data-cfg") as keyof ChartConfig;
    const val = btn.getAttribute("data-val");
    // Toggle active state within the group
    const group = btn.parentElement!;
    group.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    // Parse value
    if (cfg === "depth") updateConfig(cfg, parseInt(val!));
    else if (cfg === "canReorder") updateConfig(cfg, val === "true");
    else updateConfig(cfg, val);
  });
});

// Initialize reorder button active state based on config
const initReorderButtons = () => {
  const enableBtn = document.getElementById("btn-reorder-enable");
  const disableBtn = document.getElementById("btn-reorder-disable");
  if (config.canReorder) {
    enableBtn?.classList.add("active");
    disableBtn?.classList.remove("active");
  } else {
    enableBtn?.classList.remove("active");
    disableBtn?.classList.add("active");
  }
};
initReorderButtons();

// Global Esc handler — cancel any active draft.
// Per-component Esc is handled inside each chart/table (they check editor
// state on their own keyup/cancel paths); this is the fallback for the case
// where focus is outside both surfaces.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const active = kernel.drafts.activeEditor;
    if (active && active.state === "Drafting") {
      const dv = icicle._dataView;
      if (dv && dv.editor === active) dv.cancel();
      else {
        const tDv = table._dataView;
        if (tDv && tDv.editor === active) tDv.cancel();
      }
    }
  }
});

// Status display
const icicleStatus = document.getElementById("icicle-status")!;
const tableStatus = document.getElementById("table-status")!;
kernel.drafts.subscribe((isDrafting, activeEditor) => {
  const label = isDrafting ? "drafting" : "idle";
  icicleStatus.textContent = label;
  tableStatus.textContent = label;
  if (isDrafting) {
    icicleStatus.classList.add("drafting");
    tableStatus.classList.add("drafting");
  } else {
    icicleStatus.classList.remove("drafting");
    tableStatus.classList.remove("drafting");
  }
});

// Expose kernel globally for testing
(window as any).__kernel = kernel;

console.log("icicle harness ready", { kernel, config });
