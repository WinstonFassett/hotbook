import { useState } from 'react';
import type { Writable } from 'bireactive';

export interface DataRow {
  id: string;
  label: string;
  value: Writable<number>;
}

interface DataTableProps {
  rows: DataRow[];
}

export function DataTable({ rows }: DataTableProps) {
  const [, forceUpdate] = useState({});

  // Subscribe to changes in all values
  rows.forEach(row => {
    row.value.listen(() => forceUpdate({}));
  });

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
                  value={row.value()}
                  onChange={(e) => {
                    const newVal = parseFloat(e.target.value) || 0;
                    row.value(newVal);
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
