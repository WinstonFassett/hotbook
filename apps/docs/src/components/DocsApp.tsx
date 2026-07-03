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
    <div class="layout">
      {/* TOC */}
      <nav class="toc">
        <div class="toc-header">
          <h1>vizform</h1>
          <p class="tagline">Bidirectional Data Visualization</p>
        </div>
        <ul class="toc-list">
          {examples.map((ex) => (
            <li key={ex.slug}>
              <a href={`#${ex.slug}`}>{ex.title}</a>
            </li>
          ))}
          <li><a href="#getting-started">Getting Started</a></li>
        </ul>
        <div class="toc-footer">
          <a href="https://github.com/WinstonFassett/vizform">GitHub</a>
          <span>·</span>
          <a href="/sliceboard/">Sliceboard</a>
        </div>
      </nav>

      {/* Main */}
      <main class="main-content">
        <section id="hero" class="hero">
          <h1>vizform</h1>
          <p>
            Framework-agnostic data visualization with true bidirectional binding.
            Drag a chart element to update data. Edit data to update the chart.
            All powered by bireactive.
          </p>
        </section>

        {examples.map((ex) => (
          <section key={ex.slug} id={ex.slug} class="example-section">
            <div class="example-header">
              <h2>{ex.title}</h2>
              <span class={`maturity-badge maturity-${ex.maturity}`}>{ex.maturity}</span>
            </div>
            <p class="example-description">{ex.description}</p>
            <div class="example-content">{ex.render()}</div>
            {ex.source && (
              <div class="example-source">
                <button class="source-toggle" onClick={() => setShowSource(s => ({ ...s, [ex.slug]: !s[ex.slug] }))}>
                  {showSource[ex.slug] ? 'Hide source' : 'Show source'}
                </button>
                {showSource[ex.slug] && (
                  <pre class="source-code"><code>{ex.source}</code></pre>
                )}
              </div>
            )}
          </section>
        ))}

        <section id="getting-started" class="getting-started">
          <h2>Getting Started</h2>
          <p>Install the packages you need:</p>
          <pre><code>npm install @winstonfassett/vizform-react-d3 @winstonfassett/vizform-core bireactive</code></pre>
          <p>Check out the examples above to see how to use vizform in your project.</p>
          <p>
            <a href="https://github.com/WinstonFassett/vizform" style="color: var(--accent);">
              View on GitHub →
            </a>
          </p>
        </section>
      </main>
    </div>
  );
}
