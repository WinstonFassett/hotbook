// Bidirectional demos — vanilla TS, no React.
// Mounts BR-LC custom elements and wires two-way binding through bireactive.
//
// Binding works through shared bireactive cells:
//   - Bar chart: externalData uses plain {label, value} objects in a dataCell.
//     Table edits write to dataCell, chart reads reactively.
//     Chart drags mutate dataCell, effect updates table live.
//   - Icicle + Treetable: share the same BiNode tree (externalRoot).
//     Treetable edits write to node.value.total cells.
//     Icicle drags write to the same cells.
//     Both update live through bireactive reactivity.
//
// Key: set externalData/externalRoot BEFORE appending the element to the DOM,
// so scene() reads our data on connectedCallback.

import { effect, num } from 'bireactive';
import {
  MdBarChartLC,
  MdIcicleLC,
  MdTreetableLC,
  leaf,
  group,
} from '@fiddleviz/bireactive';
import type { ColumnDef } from '@fiddleviz/bireactive';

// Expose tree constructors for console poking and the e2e lifecycle tests.
(window as unknown as Record<string, unknown>).fiddlevizCharts = { leaf, group };

// Register custom elements once
if (!customElements.get('v-br-bar')) {
  customElements.define('v-br-bar', MdBarChartLC as CustomElementConstructor);
}
if (!customElements.get('v-br-icicle')) {
  customElements.define('v-br-icicle', MdIcicleLC as CustomElementConstructor);
}
if (!customElements.get('v-br-treetable')) {
  customElements.define('v-br-treetable', MdTreetableLC as CustomElementConstructor);
}

// ─── Bar Chart ↔ Table ───────────────────────────────────────────────────────

function initBarDemo() {
  const container = document.getElementById('bar-chart-container');
  const tableContainer = document.getElementById('bar-table-container');
  if (!container || !tableContainer) return;

  // Use bireactive num cells for each value — chart and table share these
  const rows = [
    { label: 'Apples',  value: num(30) },
    { label: 'Bananas', value: num(45) },
    { label: 'Oranges', value: num(25) },
    { label: 'Grapes',  value: num(60) },
  ];

  // Create element, set data BEFORE append
  const chartEl = document.createElement('v-br-bar') as any;
  chartEl.style.width = '100%';
  chartEl.style.height = '400px';
  chartEl.externalData = rows.map(r => ({ label: r.label, value: r.value.value }));
  container.appendChild(chartEl);

  // Render table
  function renderTable() {
    tableContainer.innerHTML = `
      <table>
        <thead><tr><th>Label</th><th>Value</th></tr></thead>
        <tbody>
          ${rows.map((r, i) => `<tr><td>${r.label}</td><td><input type="number" data-idx="${i}" value="${r.value.value}"></td></tr>`).join('')}
        </tbody>
      </table>
    `;
    tableContainer.querySelectorAll('input[type="number"]').forEach(input => {
      input.addEventListener('input', () => {
        const idx = parseInt(input.dataset.idx!, 10);
        const val = parseFloat(input.value) || 0;
        // Write to the bireactive cell — chart updates live
        rows[idx].value.value = val;
        // Also push to chart's dataCell so it re-renders
        chartEl.externalData = rows.map(r => ({ label: r.label, value: r.value.value }));
      });
    });
  }
  renderTable();

  // Chart → Table: watch chart's dataCell for drag edits, update inputs live
  effect(() => {
    const data = chartEl.dataCell?.value as { label: string; value: number }[] | undefined;
    if (!data) return;
    // Read each value to track deps
    data.forEach(d => { void d.value; });
    // Update table inputs
    const inputs = tableContainer.querySelectorAll('input[type="number"]');
    data.forEach((d, i) => {
      const input = inputs[i] as HTMLInputElement | undefined;
      if (input && document.activeElement !== input && parseFloat(input.value) !== d.value) {
        input.value = String(d.value);
      }
    });
  });
}

// ─── Icicle ↔ Treetable ──────────────────────────────────────────────────────

function initIcicleTreetableDemo() {
  const chartContainer = document.getElementById('icicle-chart-container');
  const tableContainer = document.getElementById('icicle-table-container');
  if (!chartContainer || !tableContainer) return;

  const colors = ['#e08888', '#d4a86c', '#7ec87e', '#60c4c0', '#7aaae8', '#b090e0'];

  // Build a shared BiNode tree — both icicle and treetable read from this
  const frontend = leaf('frontend', 'Frontend', 50, colors[0]);
  const backend  = leaf('backend',  'Backend',  70, colors[1]);
  const engineering = group('engineering', 'Engineering', colors[0], [frontend, backend]);

  const content = leaf('content', 'Content', 40, colors[2]);
  const social  = leaf('social',  'Social',  40, colors[3]);
  const marketing = group('marketing', 'Marketing', colors[2], [content, social]);

  const root = group('root', 'Portfolio', '#333', [engineering, marketing]);

  // Create icicle, set tree BEFORE append
  const icicleEl = document.createElement('v-br-icicle') as any;
  icicleEl.style.width = '100%';
  icicleEl.style.height = '400px';
  icicleEl.externalRoot = root;
  chartContainer.appendChild(icicleEl);

  // Create treetable, set same tree — treetable self-attaches numberDrag
  const columns: ColumnDef[] = [
    { key: 'total', label: 'Value', width: 100 },
  ];
  const treetableEl = document.createElement('v-br-treetable') as any;
  treetableEl.style.width = '100%';
  treetableEl.style.height = '400px';
  treetableEl.externalRoot = root;
  treetableEl.columns = columns;
  tableContainer.appendChild(treetableEl);

  // Both elements share the same BiNode tree with the same bireactive cells.
  // Editing a value in the treetable writes to node.value.total (a num cell).
  // Dragging in the icicle writes to the same cell via attachChartGestures.
  // Both views update live through bireactive reactivity — no event wiring needed.
}

// ─── Boot ────────────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initBarDemo();
    initIcicleTreetableDemo();
  });
} else {
  initBarDemo();
  initIcicleTreetableDemo();
}
