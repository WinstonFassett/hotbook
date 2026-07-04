import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DocsApp } from './components/DocsApp';
import './style.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DocsApp />
    </StrictMode>
  );
}
