import { useRef, useEffect } from 'react';
import { cell } from 'bireactive';
import { MdTreemapLC } from '@winstonfassett/vizform-charts';
import { DataTable } from '../components/DataTable';
import type { ExampleMeta } from './types';

// Register the custom element
if (typeof window !== 'undefined' && !customElements.get('v-br-treemap')) {
  customElements.define('v-br-treemap', MdTreemapLC as CustomElementConstructor);
}

function TreemapTableDemo() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Create hierarchical reactive data
  const data = [
    { id: 'engineering', label: 'Engineering', value: cell(120), parentId: null },
    { id: 'frontend', label: 'Frontend', value: cell(50), parentId: 'engineering' },
    { id: 'backend', label: 'Backend', value: cell(70), parentId: 'engineering' },
    { id: 'marketing', label: 'Marketing', value: cell(80), parentId: null },
    { id: 'content', label: 'Content', value: cell(40), parentId: 'marketing' },
    { id: 'social', label: 'Social', value: cell(40), parentId: 'marketing' },
  ];

  useEffect(() => {
    if (!containerRef.current) return;

    const chartEl = containerRef.current.querySelector('v-br-treemap') as any;
    if (!chartEl) return;

    // Set up chart with reactive hierarchical data
    chartEl.data = data.map(d => ({
      id: d.id,
      label: d.label,
      value: d.value,
      parentId: d.parentId,
    }));

  }, []);

  return (
    <div className="demo-container">
      <div className="demo-layout">
        <div className="demo-chart">
          <div ref={containerRef}>
            <v-br-treemap style={{ width: '100%', height: '400px' }}></v-br-treemap>
          </div>
        </div>
        <div className="demo-data">
          <h3>Budget Allocation</h3>
          <p>Click treemap cells to select. Edit values to see the layout update dynamically.</p>
          <DataTable rows={data} />
        </div>
      </div>
    </div>
  );
}

const example: ExampleMeta = {
  slug: 'treemap-table',
  title: 'Treemap ↔ Table',
  description: 'Hierarchical treemap visualization with bidirectional binding. Click cells to navigate the hierarchy, or edit values in the table to reflow the layout.',
  maturity: 'candidate',
  render: () => <TreemapTableDemo />,
  source: `// Hierarchical data with parent relationships
const data = [
  { id: 'engineering', label: 'Engineering', value: cell(120), parentId: null },
  { id: 'frontend', label: 'Frontend', value: cell(50), parentId: 'engineering' },
  // ...
];

// Treemap shows hierarchy and proportions
<v-br-treemap data={data} />

// Edit table to update treemap layout
<DataTable rows={data} />`,
};

export default example;
