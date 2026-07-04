import { useEffect, useState } from 'react';
import type { ExampleMeta } from '../examples/types';

export function DocsApp() {
  const [examples, setExamples] = useState<ExampleMeta[]>([]);
  const [showSource, setShowSource] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Load examples client-side to avoid SSR issues with Web Components
    import('../examples').then(({ getExamples }) => {
      setExamples(getExamples(['released', 'candidate']));
    });
  }, []);

  return (
    <div className="layout">
      {/* TOC */}
      <nav className="toc">
        <div className="toc-header">
          <h1>vizform</h1>
          <p className="tagline">Bidirectional Data Visualization</p>
        </div>
        <ul className="toc-list">
          {examples.map((ex) => (
            <li key={ex.slug}>
              <a href={`#${ex.slug}`}>{ex.title}</a>
            </li>
          ))}
          <li><a href="#getting-started">Getting Started</a></li>
        </ul>
        <div className="toc-footer">
          <a href="https://github.com/WinstonFassett/vizform">GitHub</a>
          <span>·</span>
          <a href="/sliceboard/">Sliceboard</a>
        </div>
      </nav>

      {/* Main */}
      <main className="main-content">
        <section id="hero" className="hero">
          <h1>vizform</h1>
          <p>
            Framework-agnostic data visualization with true bidirectional binding.
            Drag a chart element to update data. Edit data to update the chart.
            All powered by bireactive.
          </p>
        </section>

        {examples.map((ex) => (
          <section key={ex.slug} id={ex.slug} className="example-section">
            <div className="example-header">
              <h2>{ex.title}</h2>
              <span className={`maturity-badge maturity-${ex.maturity}`}>{ex.maturity}</span>
            </div>
            <p className="example-description">{ex.description}</p>
            <div className="example-content">{ex.render()}</div>
            {ex.source && (
              <div className="example-source">
                <button className="source-toggle" onClick={() => setShowSource(s => ({ ...s, [ex.slug]: !s[ex.slug] }))}>
                  {showSource[ex.slug] ? 'Hide source' : 'Show source'}
                </button>
                {showSource[ex.slug] && (
                  <pre className="source-code"><code>{ex.source}</code></pre>
                )}
              </div>
            )}
          </section>
        ))}

        <section id="getting-started" className="getting-started">
          <h2>Getting Started</h2>
          <p>Install the packages you need:</p>
          <pre><code>npm install @winstonfassett/vizform-react-d3 @winstonfassett/vizform-core bireactive</code></pre>
          <p>Check out the examples above to see how to use vizform in your project.</p>
          <p>
            <a href="https://github.com/WinstonFassett/vizform" style={{color: 'var(--accent)'}}>
              View on GitHub →
            </a>
          </p>
        </section>
      </main>
    </div>
  );
}
