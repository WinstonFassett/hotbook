import { useEffect, useState } from 'react';
import { effect, type Writable } from 'bireactive';

export interface DataRow {
  id: string;
  label: string;
  value: Writable<Cell<number>>;
}

interface DataTableProps {
  rows: DataRow[];
}

export function DataTable({ rows }: DataTableProps) {
  const [, forceUpdate] = useState({});

  // Subscribe to changes in all values via bireactive effect.
  // Reading .value inside effect() auto-tracks deps; no manual .listen.
  useEffect(() => {
    const dispose = effect(() => {
      rows.forEach(row => { void row.value.value; });
      forceUpdate({});
    });
    return dispose;
  }, [rows]);

  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.label}</td>
              <td>
                <input
                  type="number"
                  value={row.value.value}
                  onChange={(e) => {
                    const newVal = parseFloat(e.target.value) || 0;
                    row.value.value = newVal;
                  }}
                  style={{ width: '80px' }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
