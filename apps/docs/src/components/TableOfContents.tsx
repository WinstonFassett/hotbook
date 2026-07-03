import { useState, useEffect } from 'react';
import type { ExampleMeta } from '../examples/types';

interface TableOfContentsProps {
  examples: ExampleMeta[];
}

export function TableOfContents({ examples }: TableOfContentsProps) {
  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-100px 0px -66%' }
    );

    examples.forEach((example) => {
      const el = document.getElementById(example.slug);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [examples]);

  const scrollToSection = (slug: string) => {
    const el = document.getElementById(slug);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <nav className="toc">
      <div className="toc-header">
        <h1>vizform</h1>
        <p className="tagline">Bidirectional Data Visualization</p>
      </div>
      <ul className="toc-list">
        <li>
          <a
            href="#hero"
            className={activeSection === 'hero' ? 'active' : ''}
            onClick={(e) => { e.preventDefault(); scrollToSection('hero'); }}
          >
            Introduction
          </a>
        </li>
        {examples.map((example) => (
          <li key={example.slug}>
            <a
              href={`#${example.slug}`}
              className={activeSection === example.slug ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); scrollToSection(example.slug); }}
            >
              {example.title}
            </a>
          </li>
        ))}
        <li>
          <a
            href="#getting-started"
            className={activeSection === 'getting-started' ? 'active' : ''}
            onClick={(e) => { e.preventDefault(); scrollToSection('getting-started'); }}
          >
            Getting Started
          </a>
        </li>
      </ul>
      <div className="toc-footer">
        <a href="https://github.com/WinstonFassett/vizform" target="_blank" rel="noopener">
          GitHub
        </a>
        <span>·</span>
        <a href="https://www.npmjs.com/package/@winstonfassett/vizform-core" target="_blank" rel="noopener">
          npm
        </a>
      </div>
    </nav>
  );
}
