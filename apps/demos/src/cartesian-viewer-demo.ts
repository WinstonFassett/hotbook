// Zoomable Scatterplot Demo - demonstrates CartesianViewer with axis-aware pan/zoom
import { Diagram } from '../../../packages/bireactive/src/lib/diagram';
import { CartesianViewer, type CartesianDomain } from '@hotbook/bireactive';
import type { Mount } from 'bireactive';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Generate random scatterplot data
function generateScatterData(n: number): Array<{ x: number; y: number; r: number }> {
  const data: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < n; i++) {
    data.push({
      x: Math.random() * 100,
      y: Math.random() * 100,
      r: 2 + Math.random() * 5,
    });
  }
  return data;
}

export class MdCartesianViewerDemo extends Diagram {
  private viewer?: CartesianViewer;
  private data = generateScatterData(200);

  protected scene(s: Mount): void {
    const W = 800;
    const H = 600;

    // Set fixed viewBox
    this.view(W, H);

    // Initialize CartesianViewer with domain
    const domain: CartesianDomain = {
      xMin: 0,
      xMax: 100,
      yMin: 0,
      yMax: 100,
    };

    this.viewer = new CartesianViewer(this.svg, domain, W, H, {
      enablePan: true,
      enableZoom: true,
      showGrid: true,
      xLabel: 'X Axis',
      yLabel: 'Y Axis',
      gridColor: '#2a2d34',
      axisColor: '#cdd5e0',
    });

    // Render scatter points
    this.renderScatter();

    // Add controls
    this.addControls();
  }

  private renderScatter(): void {
    const dataGroup = this.viewer?.getDataGroup();
    if (!dataGroup) return;

    // Clear existing
    dataGroup.innerHTML = '';

    // Get current scales
    const xScale = this.viewer!.getXScale();
    const yScale = this.viewer!.getYScale();

    // Render points
    for (const point of this.data) {
      const cx = xScale(point.x);
      const cy = yScale(point.y);

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', String(point.r));
      circle.setAttribute('fill', '#4dabf7');
      circle.setAttribute('opacity', '0.6');
      circle.setAttribute('stroke', '#2d7db8');
      circle.setAttribute('stroke-width', '1');

      dataGroup.appendChild(circle);
    }

    // Re-render on scale changes
    // TODO: Make this reactive via effect() on scales
  }

  private addControls(): void {
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;';

    const buttons = [
      { label: 'Reset', action: () => { this.viewer?.reset(); this.renderScatter(); } },
      { label: 'Zoom In', action: () => { this.viewer?.zoomBy(1.3); this.renderScatter(); } },
      { label: 'Zoom Out', action: () => { this.viewer?.zoomBy(1 / 1.3); this.renderScatter(); } },
      { label: 'Pan Left', action: () => { this.viewer?.pan(-5, 0); this.renderScatter(); } },
      { label: 'Pan Right', action: () => { this.viewer?.pan(5, 0); this.renderScatter(); } },
      { label: 'Pan Up', action: () => { this.viewer?.pan(0, -5); this.renderScatter(); } },
      { label: 'Pan Down', action: () => { this.viewer?.pan(0, 5); this.renderScatter(); } },
    ];

    for (const btn of buttons) {
      const button = document.createElement('button');
      button.textContent = btn.label;
      button.style.cssText = 'padding:6px 12px;background:#2a2d34;border:1px solid #3a3d44;color:#cdd5e0;border-radius:4px;cursor:pointer;font-size:13px;';
      button.addEventListener('click', btn.action);
      button.addEventListener('mouseenter', () => { button.style.background = '#3a3d44'; });
      button.addEventListener('mouseleave', () => { button.style.background = '#2a2d34'; });
      controls.appendChild(button);
    }

    this.chromeLayer.appendChild(controls);

    // Add instructions
    const info = document.createElement('div');
    info.style.cssText = 'margin-top:12px;padding:12px;background:#1a1d24;border:1px solid #2a2d34;border-radius:6px;font-size:13px;line-height:1.6;';
    info.innerHTML = `
      <strong>Cartesian Viewer:</strong> Drag to pan • Scroll wheel to zoom • Notice axes rescale
      <br>
      <em>This demonstrates D3-style axis-aware pan/zoom with scale updates</em>
    `;
    this.chromeLayer.appendChild(info);
  }

  disconnectedCallback(): void {
    this.viewer?.dispose();
    super.disconnectedCallback();
  }
}
