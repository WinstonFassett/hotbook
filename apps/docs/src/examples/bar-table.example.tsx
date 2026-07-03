import { useRef, useEffect } from 'react';
import { cell } from 'bireactive';
import { MdBarChartLC } from '@winstonfassett/vizform-charts';
import { DataTable } from '../components/DataTable';
import type { ExampleMeta } from './types';

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('v-br-bar')) {
  customElements.define('v-br-bar', MdBarChartLC as CustomElementConstructor);
}

function BarTableDemo() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Create reactive data
  const data = [
    { id: 'apples', label: 'Apples', value: cell(30) },
    { id: 'bananas', label: 'Bananas', value: cell(45) },
    { id: 'oranges', label: 'Oranges', value: cell(25) },
    { id: 'grapes', label: 'Grapes', value: cell(60) },
  ];

  useEffect(() => {
    if (!containerRef.current) return;

    const chartEl = containerRef.current.querySelector('v-br-bar') as any;
    if (!chartEl) return;

    // Set up chart with reactive data
    chartEl.data = data.map(d => ({
      label: d.label,
      value: d.value,
    }));

  }, []);

  return (
    <div className="demo-container">
      <div className="demo-layout">
        <div className="demo-chart">
          <div ref={containerRef}>
            <v-br-bar style={{ width: '100%', height: '400px' }}></v-br-bar>
          </div>
        </div>
        <div className="demo-data">
          <h3>Data Table</h3>
          <p>Edit values to see the chart update. Drag bars to update the table.</p>
          <DataTable rows={data} />
        </div>
      </div>
    </div>
  );
}

const example: ExampleMeta = {
  slug: 'bar-table',
  title: 'Bar Chart ↔ Table',
  description: 'Interactive bar chart with bidirectional data binding. Drag bars to update values, or edit the table to change the chart.',
  maturity: 'released',
  render: () => <BarTableDemo />,
  source: `// Data with bireactive cells
const data = [
  { id: 'apples', label: 'Apples', value: cell(30) },
  { id: 'bananas', label: 'Bananas', value: cell(45) },
  // ...
];

// Chart automatically updates when data changes
<v-br-bar data={data} />

// Table edits update the chart
<DataTable rows={data} />`,
};

export default example;
