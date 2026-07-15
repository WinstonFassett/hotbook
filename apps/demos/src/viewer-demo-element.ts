// Viewer demo custom element - demonstrates pan/zoom/show API
import { Diagram } from '../../../packages/bireactive/src/lib/diagram';
import { Viewer, type Bounds } from '@fiddleviz/bireactive';
import type { Mount } from 'bireactive';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class MdViewerDemo extends Diagram {
  private viewer?: Viewer;

  protected scene(s: Mount): void {
    const W = 1000;
    const H = 600;

    // Set fixed viewBox (will be overridden by Viewer)
    this.view(W, H);

    // Draw grid
    const grid = document.createElementNS(SVG_NS, 'g');
    for (let x = 0; x <= W; x += 50) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(x));
      line.setAttribute('y1', '0');
      line.setAttribute('x2', String(x));
      line.setAttribute('y2', String(H));
      line.setAttribute('stroke', x % 100 === 0 ? '#3a3d44' : '#2a2d34');
      line.setAttribute('stroke-width', x % 100 === 0 ? '2' : '1');
      grid.appendChild(line);
    }
    for (let y = 0; y <= H; y += 50) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', '0');
      line.setAttribute('y1', String(y));
      line.setAttribute('x2', String(W));
      line.setAttribute('y2', String(y));
      line.setAttribute('stroke', y % 100 === 0 ? '#3a3d44' : '#2a2d34');
      line.setAttribute('stroke-width', y % 100 === 0 ? '2' : '1');
      grid.appendChild(line);
    }
    this.svg.appendChild(grid);

    // Draw colorful shapes
    const shapes = document.createElementNS(SVG_NS, 'g');

    // Top region (red boxes)
    for (let i = 0; i < 5; i++) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(100 + i * 150));
      rect.setAttribute('y', '50');
      rect.setAttribute('width', '100');
      rect.setAttribute('height', '100');
      rect.setAttribute('fill', '#ff6b6b');
      rect.setAttribute('opacity', '0.7');
      shapes.appendChild(rect);
    }

    // Middle region (blue circles)
    for (let i = 0; i < 4; i++) {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(200 + i * 200));
      circle.setAttribute('cy', '300');
      circle.setAttribute('r', '60');
      circle.setAttribute('fill', '#4dabf7');
      circle.setAttribute('opacity', '0.7');
      shapes.appendChild(circle);
    }

    // Bottom region (green triangles)
    for (let i = 0; i < 3; i++) {
      const x = 250 + i * 250;
      const y = 500;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${x},${y-50} L ${x+50},${y+50} L ${x-50},${y+50} Z`);
      path.setAttribute('fill', '#51cf66');
      path.setAttribute('opacity', '0.7');
      shapes.appendChild(path);
    }

    this.svg.appendChild(shapes);

    // Add labels
    const topLabel = document.createElementNS(SVG_NS, 'text');
    topLabel.setAttribute('x', '500');
    topLabel.setAttribute('y', '30');
    topLabel.setAttribute('text-anchor', 'middle');
    topLabel.setAttribute('fill', '#cdd5e0');
    topLabel.setAttribute('font-size', '16');
    topLabel.textContent = 'Top Region';
    this.svg.appendChild(topLabel);

    const bottomLabel = document.createElementNS(SVG_NS, 'text');
    bottomLabel.setAttribute('x', '500');
    bottomLabel.setAttribute('y', '580');
    bottomLabel.setAttribute('text-anchor', 'middle');
    bottomLabel.setAttribute('fill', '#cdd5e0');
    bottomLabel.setAttribute('font-size', '16');
    bottomLabel.textContent = 'Bottom Region';
    this.svg.appendChild(bottomLabel);

    // Initialize Viewer
    const rect = this.svg.getBoundingClientRect();
    this.viewer = new Viewer(
      this.svg,
      { x: 0, y: 0, w: W, h: H },
      rect.width || W,
      rect.height || H,
      {
        enablePan: true,
        enableZoom: true,
        minZoom: 0.5,
        maxZoom: 5,
      }
    );

    // Add control buttons
    this.addControls();
  }

  private addControls(): void {
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;';

    const buttons = [
      { label: 'Fit', action: () => this.viewer?.fit({ x: 0, y: 0, w: 1000, h: 600 }, 10) },
      { label: 'Zoom In', action: () => this.viewer?.zoomBy(1.3) },
      { label: 'Zoom Out', action: () => this.viewer?.zoomBy(1 / 1.3) },
      { label: 'Show Top', action: () => this.viewer?.show({ x: 50, y: 0, w: 900, h: 200 }, { padding: 20 }) },
      { label: 'Show Bottom', action: () => this.viewer?.show({ x: 100, y: 400, w: 800, h: 200 }, { padding: 20 }) },
      { label: 'Pan Left', action: () => this.viewer?.pan(-100, 0) },
      { label: 'Pan Right', action: () => this.viewer?.pan(100, 0) },
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
      <strong>Try it:</strong> Drag to pan • Scroll wheel to zoom • Click buttons for programmatic navigation
      <br>
      <em>This demonstrates the Viewer primitive from wiki/viewer-architecture.md</em>
    `;
    this.chromeLayer.appendChild(info);
  }

  disconnectedCallback(): void {
    this.viewer?.dispose();
    super.disconnectedCallback();
  }
}
