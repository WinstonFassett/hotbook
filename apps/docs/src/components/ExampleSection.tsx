import { useState } from 'react';
import type { ExampleMeta } from '../examples/types';

interface ExampleSectionProps {
  example: ExampleMeta;
}

export function ExampleSection({ example }: ExampleSectionProps) {
  const [showSource, setShowSource] = useState(false);

  return (
    <section id={example.slug} className="example-section">
      <div className="example-header">
        <h2>{example.title}</h2>
        <span className={`maturity-badge maturity-${example.maturity}`}>
          {example.maturity}
        </span>
      </div>
      <p className="example-description">{example.description}</p>

      <div className="example-content">
        {example.render()}
      </div>

      {example.source && (
        <div className="example-source">
          <button
            className="source-toggle"
            onClick={() => setShowSource(!showSource)}
          >
            {showSource ? '▼ Hide Source' : '▶ Show Source'}
          </button>
          {showSource && (
            <pre className="source-code">
              <code>{example.source}</code>
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
